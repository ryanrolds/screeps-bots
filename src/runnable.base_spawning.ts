/**
 * Base Creep Spawning
 *
 * Tracks the spawns in a base, pull events from the spawn topic, and spawns the requested creeps.
 *
 * TODO - Move to topic with base id in the name - IN PROGRESS
 */
import {title} from "process";
import {BaseConfig} from "./config";
import * as CREEPS from "./constants.creeps";
import {DEFINITIONS} from './constants.creeps';
import * as MEMORY from "./constants.memory";
import * as TOPICS from "./constants.topics";
import {createCreep} from "./helpers.creeps";
import {Event} from "./lib.event_broker";
import {Request} from "./lib.topics";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import {running, terminate} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getLinesStream, HudLine, HudEventSet, HudIndicatorStatus, HudIndicator, getDashboardStream} from "./runnable.debug_hud";

const SPAWN_TTL = 5;
const REQUEST_BOOSTS_TTL = 5;
const MAX_COLONY_SPAWN_DISTANCE = 5;
const PRODUCE_EVENTS_TTL = 20;

const INITIAL_TOPIC_LENGTH = 9999;
const RED_TOPIC_LENGTH = 10;
const YELLOW_TOPIC_LENGTH = 5;

export function getBaseSpawnTopic(baseId: string) {
  return `base_${baseId}_spawn`;
}

export function getKingdomSpawnTopic() {
  return 'kingdom_spawn';
}

type SpawnRequestDetails = {
  role: string;
  memory: any;
};

type SpawnRequest = Request & {
  details: SpawnRequestDetails;
};

export function createSpawnRequest(role: string, memory: any, priority: number,
  ttl: number): SpawnRequest {
  return {
    priority,
    details: {
      role: role,
      memory: memory,
    },
    ttl,
  };
}

export default class SpawnManager {
  orgRoom: OrgRoom;
  id: string;
  spawnIds: Id<StructureSpawn>[];

  threadProduceEvents: ThreadFunc;
  threadSpawn: ThreadFunc

  constructor(id: string, room: OrgRoom) {
    this.id = id;
    this.orgRoom = room;

    const roomObject: Room = this.orgRoom.getRoomObject()
    if (!roomObject) {
      throw new Error('cannot create a spawn manager when room does not exist');
    }

    this.threadSpawn = thread('spawn_thread', SPAWN_TTL)((trace, kingdom, baseConfig) => {
      this.spawnIds = roomObject.find<StructureSpawn>(FIND_MY_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_SPAWN && structure.isActive(),
      }).map(spawn => spawn.id);

      this.spawning(trace, kingdom, baseConfig);
    });

    this.threadProduceEvents = thread('produce_events_thread',
      PRODUCE_EVENTS_TTL)((trace, kingdom, baseConfig) => {
        this.processEvents(trace, kingdom, baseConfig)
      });
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('spawn_manager_run');

    const roomObject: Room = this.orgRoom.getRoomObject()
    if (!roomObject) {
      trace.error('no room object', {room: this.orgRoom.id});
      trace.end();
      return terminate();
    }

    const baseConfig = kingdom.getPlanner().getBaseConfigByRoom(this.orgRoom.id);
    if (!baseConfig) {
      trace.error('no base config for room', {room: this.orgRoom.id});
      trace.end();
      return terminate();
    }

    trace.log('Spawn manager run', {id: this.id, spawnIds: this.spawnIds});

    this.threadSpawn(trace, kingdom, baseConfig);
    this.threadProduceEvents(trace, kingdom, baseConfig);

    trace.end();
    return running();
  }

  spawning(trace: Tracer, kingdom: Kingdom, base: BaseConfig) {
    // If there are no spawns then we should request another base in the kingdom produce the creep
    if (this.spawnIds.length === 0) {
      trace.warn('sending spawn requests to kingdom', {id: this.id, spawnIds: this.spawnIds});

      let request: SpawnRequest = null;
      while (request = kingdom.getNextRequest(getBaseSpawnTopic(base.id))) {
        kingdom.sendRequest(getKingdomSpawnTopic(), request.priority, request.details,
          request.ttl);
      }

      return;
    }

    // iterate spawns and fetch next request if idle
    this.spawnIds.forEach((id) => {
      const spawn = Game.getObjectById(id);
      if (!spawn) {
        return;
      }

      const isIdle = !spawn.spawning;
      const energy = spawn.room.energyAvailable;
      const energyCapacity = spawn.room.energyCapacityAvailable;
      const energyPercentage = energy / energyCapacity;

      trace.log('spawn status', {id, isIdle, energy, energyCapacity, energyPercentage})

      if (!isIdle) {
        const creep = Game.creeps[spawn.spawning.name];
        const role = creep.memory[MEMORY.MEMORY_ROLE];
        const boosts = CREEPS.DEFINITIONS[role].boosts;
        const priority = CREEPS.DEFINITIONS[role].processPriority;

        trace.log('spawning', {creepName: creep.name, role, boosts, priority});

        if (boosts) {
          this.requestBoosts(spawn, boosts, priority);
        }

        spawn.room.visual.text(
          spawn.spawning.name + '🛠️',
          spawn.pos.x - 1,
          spawn.pos.y,
          {align: 'right', opacity: 0.8},
        );
      } else {
        const spawnTopicSize = kingdom.getTopicLength(getBaseSpawnTopic(base.id));
        const spawnTopicBackPressure = Math.floor(energyCapacity * (1 - (0.09 * spawnTopicSize)));
        let energyLimit = _.max([300, spawnTopicBackPressure]);

        let minEnergy = 300;
        const numCreeps = (this.orgRoom as any).getColony().numCreeps;

        /*
        if (energyCapacity > 800) {
          if (numCreeps > 50) {
            minEnergy = energyCapacity * 0.90;
          } else if (numCreeps > 30) {
            minEnergy = energyCapacity * 0.50;
          } else if (numCreeps > 20) {
            minEnergy = energyCapacity * 0.40;
          } else if (numCreeps > 10) {
            minEnergy = 500;
          }
        }
        */

        minEnergy = _.max([300, minEnergy]);

        const next = kingdom.peekNextRequest(getBaseSpawnTopic(base.id));
        trace.log('spawn idle', {spawnTopicSize, numCreeps, energy, minEnergy, spawnTopicBackPressure, next});

        if (energy < minEnergy) {
          trace.log("low energy, not spawning", {id: this.id, energy, minEnergy})
          return;
        }

        let request = kingdom.getNextRequest(getBaseSpawnTopic(base.id));
        if (request) {
          const role = request.details.role;
          const definition = DEFINITIONS[role];
          if (definition.energyMinimum && energy < definition.energyMinimum) {
            trace.warn('not enough energy', {energy, request, definition});
            return;
          }

          // Allow request to override energy limit
          if (request.details.energyLimit) {
            energyLimit = request.details.energyLimit;
          }

          const minEnergy = request.details[MEMORY.SPAWN_MIN_ENERGY] || 0;
          if (energy < minEnergy) {
            trace.warn('colony does not have energy', {minEnergy, energy, request});
            return;
          }

          trace.log("colony spawn request", {id: this.id, role, energy, energyLimit, request});

          this.createCreep(spawn, request.details.role, request.details.memory, energy, energyLimit);
          return;
        }

        const peek = this.orgRoom.getKingdom().peekNextRequest(getKingdomSpawnTopic());
        if (peek) {
          const role = peek.details.role;
          const definition = DEFINITIONS[role];
          const numColonies = this.orgRoom.getKingdom().getColonies().length;

          if (definition.energyMinimum && energy < definition.energyMinimum && numColonies > 3) {
            trace.warn('not enough energy', {energy, peek, definition});
            return;
          }
        }

        const resources = this.orgRoom.getColony().getReserveResources()
        const reserveEnergy = resources[RESOURCE_ENERGY] || 0;
        if (reserveEnergy < 100000) {
          trace.warn('reserve energy too low, dont handle requests from other colonies', {reserveEnergy});
          return;
        }

        // Check inter-colony requests if the colony has spawns
        const topic = this.orgRoom.getKingdom().getTopics()
        request = topic.getMessageOfMyChoice(getKingdomSpawnTopic(), (messages) => {
          const selected = messages.filter((message) => {
            const assignedShard = message.details.memory[MEMORY.MEMORY_ASSIGN_SHARD] || null;
            if (assignedShard && assignedShard != Game.shard.name) {
              let portals: any[] = this.orgRoom.getKingdom().getScribe()
                .getPortals(assignedShard).filter((portal) => {
                  const distance = Game.map.getRoomLinearDistance(this.orgRoom.id,
                    portal.pos.roomName);
                  return distance < 2;
                });

              if (!portals.length) {
                return false;
              }

              return true;
            }

            trace.log('choosing', {message})

            let destinationRoom = null;

            const baseRoom = message.details.memory[MEMORY.MEMORY_BASE];
            if (baseRoom) {
              destinationRoom = baseRoom
            }

            const assignedRoom = message.details.memory[MEMORY.MEMORY_ASSIGN_ROOM];
            if (assignedRoom) {
              destinationRoom = assignedRoom;
            }

            const positionRoom = message.details.memory[MEMORY.MEMORY_POSITION_ROOM];
            if (positionRoom) {
              destinationRoom = positionRoom;
            }

            trace.log('choosing', {destinationRoom})

            if (!destinationRoom) {
              trace.warn('no destination room', {message})
              return false;
            }

            // TODO Replace with a room distance check
            const distance = Game.map.getRoomLinearDistance((this.orgRoom as any).id, destinationRoom);
            if (distance > MAX_COLONY_SPAWN_DISTANCE) {
              trace.warn('distance to far', {distance, message});
              return false;
            }

            return true;
          });

          if (!selected.length) {
            return null;
          }

          return selected[0];
        });

        if (request) {
          trace.notice('kingdom spawn request', {roomName: this.orgRoom.id, role: request?.details?.role});
          this.createCreep(spawn, request.details.role, request.details.memory, energy, energyLimit);
          return;
        }
      }
    });
  }

  processEvents(trace: Tracer, kingdom: Kingdom, baseConfig: BaseConfig) {
    const baseTopic = kingdom.getTopics().getTopic(getBaseSpawnTopic(baseConfig.id));

    let creeps = [];
    let topicLength = 9999;
    if (baseTopic) {
      topicLength = baseTopic.length;
      creeps = baseTopic.map((message) => {
        return `${message.details[MEMORY.MEMORY_ROLE]}(${message.priority},${message.ttl - Game.time})`;
      });
    }

    const line: HudLine = {
      key: `${this.id}`,
      room: this.orgRoom.id,
      order: 5,
      text: `Next spawn: ${creeps.join(',')}`,
      time: Game.time,
    };
    const event = new Event(this.id, Game.time, HudEventSet, line);
    trace.log('produce_events', event);
    kingdom.getBroker().getStream(getLinesStream()).publish(event)

    const indicatorStream = kingdom.getBroker().getStream(getDashboardStream());

    // Processes
    let processStatus = HudIndicatorStatus.Green;
    if (topicLength === INITIAL_TOPIC_LENGTH) {
      processStatus = HudIndicatorStatus.Stale;
    } else if (topicLength > RED_TOPIC_LENGTH) {
      processStatus = HudIndicatorStatus.Red;
    } else if (topicLength > YELLOW_TOPIC_LENGTH) {
      processStatus = HudIndicatorStatus.Yellow;
    }

    const roomName = this.orgRoom.id;
    const spawnLengthIndicator: HudIndicator = {room: roomName, key: 'spawn_length', display: 'S', status: processStatus};
    indicatorStream.publish(new Event(this.id, Game.time, HudEventSet, spawnLengthIndicator));
  }

  createCreep(spawner: StructureSpawn, role, memory, energy: number, energyLimit: number) {
    return createCreep((this.orgRoom as any).getColony().id, (this.orgRoom as any).id, spawner,
      role, memory, energy, energyLimit);
  }

  requestBoosts(spawn: StructureSpawn, boosts, priority: number) {
    (this.orgRoom as any).sendRequest(TOPICS.BOOST_PREP, priority, {
      [MEMORY.TASK_ID]: `bp-${spawn.id}-${Game.time}`,
      [MEMORY.PREPARE_BOOSTS]: boosts,
    }, REQUEST_BOOSTS_TTL);
  }
}
