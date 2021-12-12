import {ColonyConfig, KingdomConfig, ShardConfig} from "./config";
import {createOpenSpaceMatrix} from "./lib.costmatrix";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";
import {pickExpansion} from "./lib.expand";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {Process, RunnableResult, running, sleeping} from "./os.process";
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from "./os.thread";
import {ColonyManager} from "./runnable.manager.colony";

const RUN_TTL = 50;
const REMOTE_MINING_TTL = 50;
const EXPAND_TTL = 250;
const MIN_DISTANCE_FOR_ORIGIN = 7;

export class CentralPlanning {
  private config: KingdomConfig;
  private scheduler: Scheduler;
  private username: string;
  private shards: string[];
  private colonyConfigs: Record<string, ColonyConfig>;
  private roomByColonyId: Record<string, string>;
  private remoteMiningThread: ThreadFunc;
  private expandThread: ThreadFunc;

  constructor(config: KingdomConfig, scheduler: Scheduler, trace: Tracer) {
    this.config = config;
    this.scheduler = scheduler;
    this.shards = [];
    this.colonyConfigs = {};
    this.roomByColonyId = {};

    this.shards.push(Game.shard.name);

    const colonies = (Memory as any).colonies || null;
    if (colonies) {
      trace.notice('found shard memory', {colonies});
      this.colonyConfigs = colonies;
    } else if (config && config.shards && config.shards[Game.shard.name]) {
      trace.notice('found shard config', {config});
      this.colonyConfigs = config.shards[Game.shard.name];
    } else {
      trace.notice('no shard config found, bootstraping?');
    }

    // Check for spawns without colonies
    Object.values(Game.spawns).forEach((spawn) => {
      const roomName = spawn.room.name;
      const origin = new RoomPosition(spawn.pos.x, spawn.pos.y + 4, spawn.pos.roomName);

      if (!this.colonyConfigs[roomName]) {
        this.addColonyConfig(roomName, false, origin, true, trace);
      }
    });

    this.remoteMiningThread = thread('remote_mining', REMOTE_MINING_TTL)(this.remoteMining.bind(this));
    this.expandThread = thread('expand', EXPAND_TTL)(this.expand.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    // Colony manager
    const colonyManagerId = 'colony_manager';
    if (!this.scheduler.hasProcess(colonyManagerId)) {
      const colonyManager = new ColonyManager(colonyManagerId, this, this.scheduler);
      this.scheduler.registerProcess(new Process(colonyManagerId, 'colony_manager',
        Priorities.CRITICAL, colonyManager));
    }

    trace.notice('running central planning', {configs: this.getColonyConfigs()});

    this.remoteMiningThread(trace, kingdom);
    this.expandThread(trace, kingdom);

    (Memory as any).colonies = this.colonyConfigs;

    return sleeping(RUN_TTL);
  }

  getShards(): string[] {
    return this.shards;
  }

  getColonyConfig(colonyId: string): ColonyConfig {
    return this.colonyConfigs[colonyId];
  }

  getColonyConfigs(): ColonyConfig[] {
    return _.values(this.colonyConfigs);
  }

  getColonyConfigList(): ColonyConfig[] {
    return _.values(this.colonyConfigs);
  }

  getColonyConfigMap(): Record<string, ColonyConfig> {
    return this.colonyConfigs;
  }

  getColonyConfigById(colonyId: string): ColonyConfig {
    return this.colonyConfigs[colonyId];
  }

  setColonyAutomation(colonyId: string, automated: boolean) {
    this.colonyConfigs[colonyId].automated = automated;
  }

  getUsername() {
    if (!this.username) {
      const spawn = _.first(_.values<StructureSpawn>(Game.spawns));
      if (!spawn) {
        throw new Error('no spawns found');
      }

      this.username = spawn.owner.username;
    }

    return this.username;
  }

  // TODO move to planner
  getFriends(): string[] {
    return this.config.friends;
  }

  getAvoid(): string[] {
    return this.config.avoid;
  }

  getKOS(): string[] {
    return this.config.kos;
  }

  addColonyConfig(colonyId: string, isPublic: boolean, origin: RoomPosition, automated: boolean,
    trace: Tracer) {
    if (this.colonyConfigs[colonyId]) {
      trace.error('colony already exists', {colonyId});
      return;
    }

    trace.notice('adding colony', {colonyId, isPublic, origin, automated});

    this.colonyConfigs[colonyId] = {
      id: `${colonyId}`,
      isPublic: isPublic,
      primary: colonyId,
      rooms: [colonyId],
      automated: automated,
      origin: origin,
      parking: new RoomPosition(origin.x + 4, origin.y, origin.roomName),
    };
    this.roomByColonyId[colonyId] = colonyId;
  }

  removeColony(colonyId: string, trace: Tracer) {
    trace.notice('removing colony', {colonyId});

    const colonyConfig = this.getColonyConfig(colonyId);
    const rooms = colonyConfig.rooms;
    rooms.forEach((roomName) => {
      this.removeRoom(roomName, trace);
    });

    delete this.colonyConfigs[colonyId];
  }

  private expand(trace: Tracer, kingdom: Kingdom) {
    const scribe = kingdom.getScribe();
    const globalColonyCount = scribe.getGlobalColonyCount();
    if (!globalColonyCount) {
      trace.notice('do not know global colony count yet');
      return;
    }

    const allowedColonies = Game.gcl.level;
    if (globalColonyCount >= allowedColonies) {
      trace.notice('max GCL colonies reached', {globalColonyCount, allowedColonies});
      return;
    }

    const colonyConfigs = this.getColonyConfigs();
    const numColonies = colonyConfigs.length;
    const shardColonyMax = (this.config.maxColonies || 9999);
    if (numColonies >= shardColonyMax) {
      trace.notice('max config colonies reached', {numColonies, shardColonyMax});
      return;
    }

    const results = pickExpansion(kingdom, trace);
    if (results.selected) {
      const roomName = results.selected;
      const distance = results.distance;
      const origin = results.origin;
      trace.log('selected room, adding colony', {roomName, distance, origin});
      this.addColonyConfig(roomName, false, origin, true, trace);
      return;
    }

    trace.log('no expansion selected');
  }

  private remoteMining(trace: Tracer, kingdom: Kingdom) {



    trace.log('adding remote', {room: adjacentRooms[0], colonyConfig});

    this.addRoom(colonyConfig.id, adjacentRooms[0], trace);
  }

  private getColonyConfigByRoom(roomName: string): ColonyConfig {
    const colonyId = this.roomByColonyId[roomName];
    if (!colonyId) {
      return null;
    }

    return this.getColonyConfig(colonyId);
  }

  addRoom(colonyId: string, roomName: string, trace: Tracer) {
    let colonyConfig = this.getColonyConfigByRoom(roomName);
    if (colonyConfig) {
      trace.error('room already assigned', {colonyId, roomName});
      return;
    }

    colonyConfig = this.getColonyConfig(colonyId);
    if (!colonyConfig) {
      trace.error('no colony found', {roomName});
      return;
    }

    if (colonyConfig.rooms.indexOf(roomName) !== -1) {
      trace.error('room already exists', {roomName});
      return;
    }

    colonyConfig.rooms.push(roomName);
    this.roomByColonyId[roomName] = colonyId;
  }

  removeRoom(roomName: string, trace: Tracer) {
    const colonyConfig = this.getColonyConfigByRoom(roomName);
    colonyConfig.rooms = _.without(colonyConfig.rooms, roomName);
    delete this.roomByColonyId[roomName];
  }
}

