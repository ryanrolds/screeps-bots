
import {getCreepBase} from './base';
import * as behaviorMovement from './behavior.movement';
import {MEMORY_ASSIGN_ROOM, MEMORY_SOURCE} from './constants.memory';
import {Kernel} from './kernel';
import * as behaviorTree from './lib.behaviortree';
import {FAILURE, RUNNING, SUCCESS} from './lib.behaviortree';
import {numEnemeiesNearby, numOfSourceSpots} from './lib.proximity';
import {Tracer} from './lib.tracing';

export const selectHarvestSource = behaviorTree.leafNode(
  'bt.harvest.selectHarvestSource',
  (creep: Creep, trace: Tracer, kernel: Kernel) => {
    // If creep already has source assigned, use that
    if (creep.memory[MEMORY_SOURCE]) {
      return SUCCESS;
    }

    let sources = creep.room.find(FIND_SOURCES);
    sources = _.filter(sources, (source) => {
      // Do not send creeps to sources with hostiles near by
      return numEnemeiesNearby(source.pos, 5) < 1;
    });

    const base = getCreepBase(kernel, creep);
    if (!base) {
      trace.error('creep base not found', {name: creep.name, memory: creep.memory});
      creep.suicide();
      return FAILURE;
    }

    sources = _.sortByAll(sources, (source) => {
      if (!base) {
        return 0;
      }

      const baseCreeps = kernel.getCreepsManager().getCreepsByBase(creep.room.name);
      const numAssigned = _.filter(baseCreeps, (creep) => {
        return creep.memory[MEMORY_SOURCE] === source.id;
      }).length;

      const numSpots = numOfSourceSpots(source);
      return Math.floor(numAssigned / numSpots);
    }, (source) => {
      const path = creep.pos.findPathTo(source);
      return path.length;
    });

    if (!sources || !sources.length) {
      return FAILURE;
    }

    const source = sources[0];

    behaviorMovement.setSource(creep, source.id);
    return SUCCESS;
  },
);

export const moveToHarvestRoom = behaviorTree.repeatUntilSuccess(
  'bt.movement.room.harvest',
  behaviorTree.leafNode(
    'move_to_harvest_room',
    (creep, trace, kingdom) => {
      const room = creep.memory[MEMORY_ASSIGN_ROOM];
      // If creep doesn't have a harvest room assigned, we are done
      if (!room) {
        return SUCCESS;
      }
      // If the creep reaches the room we are done
      if (creep.room.name === room) {
        return SUCCESS;
      }

      const result = creep.moveTo(new RoomPosition(25, 25, room), {
        reusePath: 50,
        maxOps: 1500,
      });
      trace.log('move to', {result});

      if (result === ERR_NO_PATH) {
        return FAILURE;
      }

      return RUNNING;
    },
  ),
);

export const moveToHarvest = behaviorTree.leafNode(
  'move_to_source',
  (creep) => {
    return behaviorMovement.moveToSource(creep, 1, false, 50, 1500);
  },
);

export const harvest = behaviorTree.leafNode(
  'fill_creep',
  (creep, trace, kingdom) => {
    const destination = Game.getObjectById<Id<Source>>(creep.memory[MEMORY_SOURCE]);
    if (!destination) {
      return FAILURE;
    }

    if (destination.energy === 0) {
      return RUNNING;
    }

    const result = creep.harvest(destination);
    trace.log('harvest', {result});

    if (creep.store.getFreeCapacity() === 0) {
      return SUCCESS;
    }

    // NOTICE switched this to FAILURE from RUNNING, this may cause problems
    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      return RUNNING;
    }

    if (result === OK) {
      return RUNNING;
    }

    return FAILURE;
  },
);
