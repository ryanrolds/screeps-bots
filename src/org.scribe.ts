import {OrgBase} from './org.base';
import {getRegion, Position} from './lib.flood_fill'
import {Kingdom} from './org.kingdom';
import {Colony} from './org.colony';
import {thread, ThreadFunc} from './os.thread';
import {Tracer} from './lib.tracing';

const COST_MATRIX_TTL = 1500;
const COST_DEFENDER_NOT_BASE = 6;
const JOURNAL_ENTRY_TTL = 250;
const WRITE_MEMORY_INTERVAL = 50;

type Journal = {
  rooms: Record<string, RoomEntry>;
  creeps: Record<string, Creep>;

};

type PortalEntry = {
  id: Id<StructurePortal>,
  pos: RoomPosition,
  destinationShard: string;
  destinationRoom: string;
};

export type RoomEntry = {
  id: Id<Room>,
  lastUpdated: number;
  controller?: {
    owner: string;
    level: number;
    safeMode: number;
    safeModeAvailable: number;
    pos: RoomPosition;
  };
  hasSpawns: boolean;
  spawnLocation: RoomPosition;
  numSources: number;
  hasHostiles: boolean;
  hasKeepers: boolean;
  invaderCorePos: RoomPosition;
  invaderCoreLevel: number;
  invaderCoreTime: number;
  numTowers: number;
  numKeyStructures: number;
  mineral: MineralConstant;
  portals: PortalEntry[];
  powerBanks: {
    id: Id<StructurePowerBank>;
    hits: number;
    ttl: number;
    power: number;
    pos: RoomPosition;
  }[];
  deposits: {
    type: DepositConstant;
    cooldown: number;
    ttl: number;
  }[];
};

export type TargetRoom = {
  id: Id<Room>;
  numTowers: number;
  numKeyStructures: number;
  owner: string;
  level: number;
  controllerPos: RoomPosition;
};

export class Scribe extends OrgBase {
  private journal: Journal;
  costMatrix255: CostMatrix;
  threadWriteMemory: ThreadFunc;

  constructor(parent, trace) {
    super(parent, 'scribe', trace);

    this.journal = Memory['scribe'] || {
      rooms: {},
      defenderCostMatrices: {},
      colonyCostMatrices: {},
    };

    this.threadWriteMemory = thread('write_memory', WRITE_MEMORY_INTERVAL)(this.writeMemory.bind(this))
  }

  writeMemory(trace: Tracer) {
    if (Game.cpu.bucket < 1000) {
      trace.notice('clearing journal from memory to reduce CPU load')
      Memory['scribe'] = null;
      return
    }

    Memory['scribe'] = this.journal;
  }

  update(trace) {
    const updateTrace = trace.begin('update');

    Object.values(Game.rooms).forEach((room) => {
      const entry = this.getRoomById(room.name);
      if (!entry || Game.time - entry.lastUpdated > JOURNAL_ENTRY_TTL) {
        this.updateRoom(this.getKingdom(), room);
      }
    });

    this.threadWriteMemory(updateTrace);

    updateTrace.end();
  }

  process(trace) {
    /*
    const username = this.getKingdom().config.username;
    const friends = this.getKingdom().config.friends;
    const visual = Game.map.visual;
    this.getRooms().forEach((room) => {
      const age = Game.time - room.lastUpdated;
      const owner = room.controller?.owner || null;

      visual.text(age.toString(), new RoomPosition(49, 47, room.id), {
        align: 'right',
        fontSize: 4,
      });

      let roomPosture = '';
      if (owner && owner !== username) {
        roomPosture += '⚔️';
      }
      if (owner === username) {
        roomPosture += '🟢';
      }
      if (room.controller?.safeMode > 0) {
        roomPosture += '💢';
      }

      visual.text(roomPosture, new RoomPosition(0, 4, room.id), {
        align: 'left',
        fontSize: 6,
      });
    });
    */
  }

  removeStaleJournalEntries() {

  }

  getRooms(): RoomEntry[] {
    return Object.values(this.journal.rooms);
  }

  getStats() {
    const rooms = Object.keys(this.journal.rooms);
    const oldestId = this.getOldestRoomInList(rooms);
    const oldestRoom = this.getRoomById(oldestId);
    const oldestAge = oldestRoom ? Game.time - oldestRoom.lastUpdated : 0;

    return {
      rooms: rooms.length,
      oldestRoom: oldestId,
      oldestAge: oldestAge,
    };
  }

  getOldestRoomInList(rooms: string[]) {
    const knownRooms = Object.keys(this.journal.rooms);
    const missingRooms = _.difference(rooms, knownRooms)
    if (missingRooms.length) {
      return _.shuffle(missingRooms)[0];
    }

    const inRangeRooms: RoomEntry[] = Object.values(_.pick(this.journal.rooms, rooms));
    const sortedRooms = _.sortBy(inRangeRooms, 'lastUpdated');
    if (!sortedRooms.length) {
      return null;
    }

    return sortedRooms[0].id;
  }

  getRoomsUpdatedRecently() {
    return Object.values(this.journal.rooms).filter((room) => {
      return Game.time - room.lastUpdated < 500;
    }).map((room) => {
      return room.id;
    });
  }

  getRoomsWithPowerBanks() {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.powerBanks) {
        return false;
      }

      return room.powerBanks.length > 0;
    }).map((room) => {
      return [room.id, Game.time - room.lastUpdated, room.powerBanks[0].ttl];
    });
  }

  getRoomsWithInvaderBases() {
    return Object.values(this.journal.rooms).filter((room) => {
      return false;
    }).map((room) => {
      return [room.id, Game.time - room.lastUpdated, room.powerBanks[0].ttl];
    });
  }

  getRoomsWithHostileTowers() {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.controller || room.controller.owner === 'ENETDOWN') {
        return false;
      }

      if (!room.numTowers) {
        return false;
      }

      return true;
    }).map((room) => {
      return [room.id, room.numTowers, room.controller.owner];
    });
  }

  getRoomsWithPortals() {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.portals) {
        return false;
      }

      return room.portals.length > 0;
    }).map((room) => {
      return [room.id, Game.time - room.lastUpdated, room.portals.map((portal) => {
        return portal.destinationShard;
      })];
    });
  }

  getWeakRooms(): TargetRoom[] {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.controller || room.controller.owner === 'ENETDOWN') {
        return false;
      }

      if (room.controller.level >= 7) {
        return false;
      }

      if (room.controller.level < 1) {
        return false;
      }

      if (room.controller.safeMode) {
        return false;
      }

      if (room.numKeyStructures < 1) {
        return false;
      }

      return true;
    }).map((room) => {
      return {
        id: room.id,
        numTowers: room.numTowers,
        numKeyStructures: room.numKeyStructures,
        owner: room.controller.owner,
        level: room.controller.level,
        controllerPos: room.controller.pos,
      };
    });
  }

  updateRoom(kingdom: Kingdom, roomObject: Room) {
    const room: RoomEntry = {
      id: roomObject.name as Id<Room>,
      lastUpdated: Game.time,
      controller: null,
      hasSpawns: false,
      spawnLocation: null,
      numSources: 0,
      hasHostiles: false,
      hasKeepers: false,
      invaderCorePos: null,
      invaderCoreLevel: null,
      invaderCoreTime: null,
      numTowers: 0,
      numKeyStructures: 0,
      mineral: null,
      powerBanks: [],
      portals: [],
      deposits: [],
    };

    if (roomObject.controller) {
      let owner = null;
      if (roomObject.controller.owner) {
        owner = roomObject.controller.owner.username;
      }

      room.controller = {
        owner: owner,
        level: roomObject.controller.level,
        safeMode: roomObject.controller.safeMode || 0,
        safeModeAvailable: roomObject.controller.safeModeAvailable,
        pos: roomObject.controller.pos,
      };

      const spawns = roomObject.find(FIND_STRUCTURES, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_SPAWN;
        },
      });
      room.hasSpawns = spawns.length > 0;
      room.spawnLocation = spawns[0]?.pos
    }

    room.numSources = roomObject.find(FIND_SOURCES).length;

    let hostiles = roomObject.find(FIND_HOSTILE_CREEPS);
    // Filter friendly creeps
    const friends = kingdom.config.friends;
    const hostileCreeps = hostiles.filter((creep) => {
      const owner = creep.owner.username;
      return friends.indexOf(owner) === -1 && owner !== 'Source Keeper';
    });
    room.hasHostiles = hostileCreeps.length > 0;

    let keepers = hostiles.filter((creep) => {
      const owner = creep.owner.username;
      return owner === 'Source Keeper';
    });
    room.hasKeepers = keepers.length > 0;

    let invaderCores: StructureInvaderCore[] = roomObject.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_INVADER_CORE;
      }
    });
    if (invaderCores.length) {
      room.invaderCorePos = invaderCores[0].pos;
      room.invaderCoreLevel = invaderCores[0].level
      room.invaderCoreTime = invaderCores[0].effects[EFFECT_COLLAPSE_TIMER]?.ticksRemaining;
    }

    room.numTowers = roomObject.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_TOWER;
      },
    }).length;

    room.numKeyStructures = roomObject.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_TOWER ||
          structure.structureType === STRUCTURE_SPAWN ||
          structure.structureType === STRUCTURE_TERMINAL ||
          structure.structureType === STRUCTURE_NUKER;
      },
    }).length;

    room.mineral = null;
    const minerals = roomObject.find(FIND_MINERALS);
    if (minerals.length) {
      room.mineral = minerals[0].mineralType;
    }

    room.portals = [];
    const portals = roomObject.find<StructurePortal>(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_PORTAL;
      },
    });
    room.portals = portals.map((portal) => {
      return {
        id: portal.id,
        pos: portal.pos,
        destinationShard: (portal.destination as any).shard,
        destinationRoom: (portal.destination as any).room,
      };
    });

    room.powerBanks = roomObject.find<StructurePowerBank>(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_POWER_BANK;
      },
    }).map((powerBank) => {
      return {
        id: powerBank.id,
        hits: powerBank.hits,
        ttl: powerBank.ticksToDecay,
        power: powerBank.power,
        pos: powerBank.pos,
      };
    });

    room.deposits = roomObject.find(FIND_DEPOSITS).map((deposit) => {
      return {
        type: deposit.depositType,
        cooldown: deposit.cooldown,
        ttl: deposit.ticksToDecay,
      };
    });

    this.journal.rooms[room.id] = room;
  }

  clearRoom(roomId: string) {
    delete this.journal.rooms[roomId];
  }

  getRoomById(roomId): RoomEntry {
    return this.journal.rooms[roomId] || null;
  }

  getLocalShardMemory(): any {
    if (typeof (InterShardMemory) === 'undefined') {
      return {} as any;
    }

    return JSON.parse(InterShardMemory.getLocal() || '{}');
  }

  setLocalShardMemory(memory: any) {
    if (typeof (InterShardMemory) === 'undefined') {
      return;
    }

    return InterShardMemory.setLocal(JSON.stringify(memory));
  }

  getRemoteShardMemory(shardName: string) {
    if (typeof (InterShardMemory) === 'undefined') {
      return {} as any;
    }

    return JSON.parse(InterShardMemory.getRemote(shardName) || '{}');
  }

  getPortals(shardName: string): PortalEntry[] {
    return Object.values(this.journal.rooms).reduce((portals, room) => {
      return portals.concat(_.filter(room.portals, _.matchesProperty('destinationShard', shardName)));
    }, [] as PortalEntry[]);
  }

  setCreepBackup(creep: Creep) {
    const localMemory = this.getLocalShardMemory();
    if (!localMemory.creep_backups) {
      localMemory.creep_backups = {};
    }

    localMemory.creep_backups[creep.name] = {
      name: creep.name,
      memory: creep.memory,
      ttl: Game.time,
    };

    localMemory.creep_backups = _.pick(localMemory.creep_backups, (backup) => {
      return Game.time - backup.ttl < 1500;
    });

    this.setLocalShardMemory(localMemory);
  }

  getCreepBackup(shardName: string, creepName: string) {
    const remoteMemory = this.getRemoteShardMemory(shardName);
    if (remoteMemory.creep_backups) {
      return remoteMemory.creep_backups[creepName] || null;
    }

    return null;
  }
}

