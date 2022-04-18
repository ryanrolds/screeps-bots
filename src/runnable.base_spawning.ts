/**
 * Base Creep Spawning
 *
 * Tracks the spawns in a base, pull events from the spawn topic, and spawns the requested creeps.
 *
 * TODO - Move to topic with base id in the name - IN PROGRESS
 */
import {title} from "process";
import {getBaseSpawnTopic} from "./topics.base";
import {BaseConfig} from "./config";
import * as CREEPS from "./constants.creeps";
import {DEFINITIONS} from './constants.creeps';
import * as MEMORY from "./constants.memory";
import * as TOPICS from "./constants.topics";
import {createCreep} from "./helpers.creeps";
import {getKingdomSpawnTopic} from "./topics.kingdom";
import {Event} from "./lib.event_broker";
import {Request} from "./lib.topics";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import {running, terminate} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getLinesStream, HudLine, HudEventSet, HudIndicatorStatus, HudIndicator, getDashboardStream} from "./runnable.debug_hud";
import {request} from "http";

const SPAWN_TTL = 5;
const REQUEST_BOOSTS_TTL = 5;
const MAX_COLONY_SPAWN_DISTANCE = 5;
const PRODUCE_EVENTS_TTL = 20;

const INITIAL_TOPIC_LENGTH = 9999;
const RED_TOPIC_LENGTH = 10;
const YELLOW_TOPIC_LENGTH = 5;

export const SPAWN_REQUEST_ROLE = "role";
export const SPAWN_REQUEST_SPAWN_MIN_ENERGY = "spawn_min_energy";
export const SPAWN_REQUEST_PARTS = "parts";

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
  checkCount: number = 0;

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
      trace.warn('base has no spawns', {id: this.id, spawnIds: this.spawnIds});

      let request: SpawnRequest = null;
      while (request = kingdom.getNextRequest(getBaseSpawnTopic(base.id))) {
        trace.notice('sending kingdom spawn request', {request: request});
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
      const spawnEnergy = spawn.room.energyAvailable;
      const energyCapacity = spawn.room.energyCapacityAvailable;
      const energyPercentage = spawnEnergy / energyCapacity;

      trace.info('spawn status', {id, isIdle, spawnEnergy, energyCapacity, energyPercentage})

      if (!isIdle) {
        const creep = Game.creeps[spawn.spawning.name];

        spawn.room.visual.text(
          spawn.spawning.name + '🛠️',
          spawn.pos.x - 1,
          spawn.pos.y,
          {align: 'right', opacity: 0.8},
        );

        const role = creep.memory[MEMORY.MEMORY_ROLE];

        if (!CREEPS.DEFINITIONS[role]) {
          trace.error('unknown role', {creepName: creep.name, role});
          return;
        }

        const boosts = CREEPS.DEFINITIONS[role].boosts;
        const priority = CREEPS.DEFINITIONS[role].processPriority;

        trace.log('spawning', {creepName: creep.name, role, boosts, priority});

        if (boosts) {
          this.requestBoosts(spawn, boosts, priority);
        }

        return;
      }

      const spawnTopicSize = kingdom.getTopicLength(getBaseSpawnTopic(base.id));
      const spawnTopicBackPressure = Math.floor(energyCapacity * (1 - (0.09 * spawnTopicSize)));
      let energyLimit = _.max([300, spawnTopicBackPressure]);

      let minEnergy = 300;
      const numCreeps = (this.orgRoom as any).getColony().numCreeps;

      minEnergy = _.max([300, minEnergy]);

      const next = kingdom.peekNextRequest(getBaseSpawnTopic(base.id));
      trace.info('spawn idle', {
        spawnTopicSize, numCreeps, spawnEnergy, minEnergy,
        spawnTopicBackPressure, next
      });

      if (spawnEnergy < minEnergy) {
        trace.info("low energy, not spawning", {id: this.id, spawnEnergy, minEnergy})
        return;
      }

      let request = null;
      const localRequest = kingdom.getNextRequest(getBaseSpawnTopic(base.id));

      let neighborRequest = null;
      const storageEnergy = spawn.room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
      if (storageEnergy < 100000) {
        trace.warn('reserve energy too low, dont handle requests from other neighbors', {storageEnergy});
      } else {
        neighborRequest = this.getNeighborRequest(kingdom, base, trace);
      }

      trace.info('spawn request', {localRequest, neighborRequest});

      // Select local request if available
      if (localRequest) {
        trace.info('found local request', {localRequest});
        request = localRequest;
      }

      // If no request selected and neighbor request available, select neighbor request
      if (!request && neighborRequest) {
        trace.warn('found neighbor request', {neighborRequest});
        request = neighborRequest;
      }

      // No request, so we are done
      if (!request) {
        trace.info("no request");
        return
      }

      // If local priority w/ bonus is less than neighbor priority, select neighbor request
      if ((request.priority + 1) < neighborRequest?.priority) {
        trace.warn("neighbor request has higher priority", {neighborRequest, request});
        request = neighborRequest;
      }

      const role = request.details.role;
      const definition = DEFINITIONS[role];
      if (definition.energyMinimum && spawnEnergy < definition.energyMinimum) {
        trace.warn('not enough energy', {spawnEnergy, request, definition});
        return;
      }

      // Allow request to override energy limit
      if (request.details.energyLimit) {
        energyLimit = request.details.energyLimit;
      }

      const requestMinEnergy = request.details[SPAWN_REQUEST_SPAWN_MIN_ENERGY] || 0;
      if (spawnEnergy < requestMinEnergy) {
        trace.warn('colony does not have energy', {requestMinEnergy, spawnEnergy, request});
        return;
      }

      trace.info("spawning", {id: this.id, role, spawnEnergy, energyLimit, request});

      this.createCreep(spawn, request.details[SPAWN_REQUEST_ROLE], request.details[SPAWN_REQUEST_PARTS] || null,
        request.details.memory, spawnEnergy, energyLimit);
    });
  }

  getNeighborRequest(kingdom: Kingdom, base: BaseConfig, trace: Tracer) {
    const topic = this.orgRoom.getKingdom().getTopics()
    const request = topic.getMessageOfMyChoice(getKingdomSpawnTopic(), (messages) => {
      // Reverse message so we get higher priority first
      const selected = _.find(messages.reverse(), (message: any) => {
        // Select message if portal nearby
        // RAKE check distance on other side of the portal too
        const assignedShard = message.details.memory[MEMORY.MEMORY_ASSIGN_SHARD] || null;
        if (assignedShard && assignedShard != Game.shard.name) {
          trace.warn('request in another shard', {assignedShard, shard: Game.shard.name});
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

        // Determine destination room
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

        // If no destination room, can be produced by anyone
        if (!destinationRoom) {
          trace.warn('no destination room, can be produced by anyone', {message});
          return true;
        }

        // If the room is part of a colony, check if the colony is a neighbor
        const destinationBase = kingdom.getPlanner().getBaseConfigByRoom(destinationRoom);
        if (destinationBase) {
          const isNeighbor = base.neighbors.some((neighborId) => {
            return neighborId == destinationBase.id;
          });
          if (isNeighbor) {
            return true;
          }
        }

        return false;
      });

      if (!selected) {
        return null;
      }

      return selected;
    });

    return request;
  }

  processEvents(trace: Tracer, kingdom: Kingdom, baseConfig: BaseConfig) {
    const baseTopic = kingdom.getTopics().getTopic(getBaseSpawnTopic(baseConfig.id));

    let creeps = [];
    let topicLength = 9999;
    if (baseTopic) {
      topicLength = baseTopic.length;
      creeps = baseTopic.map((message) => {
        return `${message.details[SPAWN_REQUEST_ROLE]}(${message.priority},${message.ttl - Game.time})`;
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
    const spawnLengthIndicator: HudIndicator = {
      room: roomName,
      key: 'spawn_length',
      display: 'S',
      status: processStatus
    };
    indicatorStream.publish(new Event(this.id, Game.time, HudEventSet, spawnLengthIndicator));
  }

  createCreep(spawner: StructureSpawn, role, parts: BodyPartConstant[], memory, energy: number, energyLimit: number) {
    return createCreep((this.orgRoom as any).getColony().id, (this.orgRoom as any).id, spawner,
      role, parts, memory, energy, energyLimit);
  }

  requestBoosts(spawn: StructureSpawn, boosts, priority: number) {
    (this.orgRoom as any).sendRequest(TOPICS.BOOST_PREP, priority, {
      [MEMORY.TASK_ID]: `bp-${spawn.id}-${Game.time}`,
      [MEMORY.PREPARE_BOOSTS]: boosts,
    }, REQUEST_BOOSTS_TTL);
  }
}
