import {AlertLevel, Base, getStructuresWithResource} from "./base";
import * as MEMORY from "./constants.memory";
import * as PRIORITIES from "./constants.priorities";
import * as TASKS from "./constants.tasks";
import {Kernel} from "./kernel";
import {Tracer} from './lib.tracing';
import {running, sleeping, terminate} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {getBaseDistributorTopic} from "./role.distributor";
import {getBasePriorityTargetsTopic} from "./runnable.manager.defense";

const REQUEST_ENERGY_TTL = 10;
const REQUEST_ENERGY_THRESHOLD = 500;
const EMERGENCY_RESERVE = 250;

interface Point {
  x: number;
  y: number;
}

export default class TowerRunnable {
  baseId: string;
  towerId: Id<StructureTower>;

  damagedCreep: string; // Creep name FIX
  repairTarget: Id<AnyStructure>;

  haulTTL: number;
  repairTTL: number;
  prevTime: number;

  constructor(baseId: string, tower: StructureTower) {
    this.baseId = baseId;
    this.towerId = tower.id;

    this.haulTTL = 0;
    this.repairTTL = 0;
    this.prevTime = Game.time;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('tower_run');

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error("no base config, terminating", {id: this.baseId})
      trace.end();
      return terminate();
    }

    const tower = Game.getObjectById(this.towerId);
    if (!tower) {
      trace.error("no tower, terminating", {id: this.towerId})
      trace.end();
      return terminate();
    }

    if (!tower.isActive()) {
      trace.error("tower is inactive, sleeping", {id: this.towerId})
      trace.end();
      return sleeping(100);
    }

    // Count towers based on which have energy
    const numPoweredTowers = tower.room.find(FIND_MY_STRUCTURES, {
      filter: (s: AnyStoreStructure) => {
        return s.structureType === STRUCTURE_TOWER && s.store.getUsedCapacity(RESOURCE_ENERGY) > 10;
      }
    }).length;

    this.haulTTL -= ticks;
    this.repairTTL -= ticks;

    const towerUsed = tower.store.getUsedCapacity(RESOURCE_ENERGY);

    trace.info("tower runnable", {
      room: tower.room.name,
      id: this.towerId,
      haulTTL: this.haulTTL,
      repairTTL: this.repairTTL,
      repairTarget: this.repairTarget,
      energy: towerUsed,
      numPoweredTowers: numPoweredTowers,
    });

    // Request energy
    if (towerUsed < REQUEST_ENERGY_THRESHOLD && this.haulTTL < 0) {
      this.haulTTL = REQUEST_ENERGY_TTL;
      trace.info('requesting energy', {});
      this.requestEnergy(kernel, base, tower, REQUEST_ENERGY_TTL, trace);
    }

    // Attack hostiles
    const roomName = tower.room.name;
    let targets = kernel.getTopics().getFilteredRequests(getBasePriorityTargetsTopic(this.baseId),
      (target) => {
        trace.info('finding target', {target, roomId: roomName});
        return target.details.roomName === roomName;
      }
    );

    // Remove targets that can heal too much
    targets = targets.filter((target) => {
      return numPoweredTowers * 600 > target.details.healingPower;
    });

    trace.info('targets', {
      targets: targets.map((t) => {
        return {
          id: t.details.id,
          healing: t.details.healingPower
        }
      }),
    });

    if (targets.length) {
      const target = Game.getObjectById<Id<Creep>>(targets[0].details.id)
      const result = tower.attack(target);
      trace.info('attacking', {target: targets[0].details.id, result})
      trace.end();
      return running();
    }

    // TODO enable this later
    // Heal damaged creeps
    // if (!this.damagedCreep && this.orgRoom.damagedCreeps.length) {
    //  this.damagedCreep = this.orgRoom.damagedCreeps.shift();
    // }

    if (this.damagedCreep) {
      const creep = Game.creeps[this.damagedCreep];
      if (!creep || creep.hits >= creep.hitsMax) {
        this.damagedCreep = null;
      } else {
        const result = tower.heal(creep);
        trace.log('healing', {target: creep.id, result})
        trace.end();
        return running();
      }
    }

    // Not above attack/heal reserve, skip repair logic
    if (towerUsed < EMERGENCY_RESERVE) {
      trace.log('skipping repairs low energy', {towerUsed});
      trace.end();
      return running();
    }

    // If low on CPU bucket, stop repairing
    if (Game.cpu.bucket < 1000) {
      trace.log('skipping repairs low bucket', {bucket: Game.cpu.bucket});
      trace.end();
      return running();
    }

    // Repair focus TTL that spreads repairs out
    if (this.repairTarget && this.repairTTL < 0) {
      trace.log('repair target ttl hit', {});
      this.repairTarget = null;
      this.repairTTL = 0;
    }

    // If target is repaired, picking another target
    if (this.repairTarget) {
      const target = Game.getObjectById(this.repairTarget);
      if (!target || target.hits >= target.hitsMax) {
        trace.log('repair target done/missing', {target});
        this.repairTarget = null;
        this.repairTTL = 0;
      }
    }

    // @REFACTOR damaged structure event streams

    // Repair damaged structure
    if (!this.repairTarget && this.orgRoom.damagedStructures.length) {
      this.repairTarget = this.orgRoom.damagedStructures.shift();
      this.repairTTL = 10;
    }

    // Do not repair secondary structures or roads if room is low on energy
    if (room.storage && this.orgRoom.getAmountInReserve(RESOURCE_ENERGY) < 10000) {
      trace.log('skipping repairs low energy', {energy: this.orgRoom.getAmountInReserve(RESOURCE_ENERGY)});
      this.repairTarget = null;
      this.repairTTL = 0;
      trace.end();
      return running();
    }

    // Repair damaged secondary structures
    if (!this.repairTarget && this.orgRoom.damagedSecondaryStructures.length) {
      let nextRepairTarget = null;
      let nextReapirTargetId = null;
      for (let i = 0; i < this.orgRoom.damagedSecondaryStructures.length; i++) {
        nextReapirTargetId = this.orgRoom.damagedSecondaryStructures[0];

        trace.log('damaged secondary structure', {nextReapirTargetId, length: this.orgRoom.damagedSecondaryStructures.length});

        nextRepairTarget = Game.getObjectById(nextReapirTargetId);
        if (!nextRepairTarget) {
          trace.log('damaged secondary structure not found', {nextReapirTargetId});
          continue;
        }

        trace.log('damaged secondary structure', {nextReapirTargetId, nextRepairTarget});
        break;
      }

      if (nextRepairTarget) {
        if (nextRepairTarget.hitsMax - nextRepairTarget.hits < 100000 && this.orgRoom.damagedSecondaryStructures.length) {
          this.repairTarget = this.orgRoom.damagedSecondaryStructures.shift();
        } else {
          this.repairTarget = nextReapirTargetId;
        }

        trace.log('repair damaged secondary target', {target: this.repairTarget});
        this.repairTTL = 10;
      }
    }

    // If no repair target sleep for a bit
    if (!this.repairTarget) {
      trace.log('no repair repair', {});
      trace.end();
      return sleeping(5);
    }

    const target = Game.getObjectById(this.repairTarget);
    if (!target) {
      trace.error('repair target missing', {target});
      this.repairTarget = null;
      this.repairTTL = 0;
      trace.end();
      return running();
    }

    const result = tower.repair(target);
    trace.log('repair', {target, result, ttl: this.repairTTL});

    trace.end();

    return running();
  }

  private requestEnergy(kernel: Kernel, base: Base, tower: StructureTower, ttl: number, trace: Tracer) {
    const towerUsed = tower.store.getUsedCapacity(RESOURCE_ENERGY);
    const towerFree = tower.store.getFreeCapacity(RESOURCE_ENERGY);
    const towerTotal = tower.store.getCapacity(RESOURCE_ENERGY);

    const pickupId = getStructuresWithResource(base, RESOURCE_ENERGY).shift();
    const priority = (base.alertLevel !== AlertLevel.GREEN ?
      PRIORITIES.HAUL_TOWER_HOSTILES : PRIORITIES.HAUL_TOWER) - (towerUsed / towerTotal);

    const details = {
      [MEMORY.TASK_ID]: `tel-${tower.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickupId,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_AMOUNT]: towerFree,
      [MEMORY.MEMORY_HAUL_DROPOFF]: tower.id,
    };

    kernel.getTopics().addRequest(getBaseDistributorTopic(this.baseId), priority, details, ttl);

    trace.log('request energy', {priority, details, towerUsed, towerTotal});
  }
}
