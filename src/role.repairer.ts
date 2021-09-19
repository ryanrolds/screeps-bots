import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING} from "./lib.behaviortree";

import * as behaviorMovement from "./behavior.movement";
import behaviorCommute from "./behavior.commute";
import * as behaviorAssign from "./behavior.assign";
import behaviorRoom from "./behavior.room";
import behaviorNonCombatant from "./behavior.noncombatant";
import {behaviorBoosts} from "./behavior.boosts";

import {MEMORY_DESTINATION} from "./constants.memory";

const selectStructureToRepair = behaviorTree.leafNode(
  'selectStructureToRepair',
  (creep, trace, kingdom) => {
    const room = kingdom.getCreepRoom(creep);
    if (!room) {
      return FAILURE;
    }

    const target = room.getNextDamagedStructure();
    if (!target) {
      return FAILURE;
    }

    behaviorMovement.setDestination(creep, target.id);

    return SUCCESS;
  },
);

const repair = behaviorTree.leafNode(
  'repair_structure',
  (creep) => {
    const destination = Game.getObjectById<Structure>(creep.memory[MEMORY_DESTINATION]);
    if (!destination) {
      return FAILURE;
    }

    // TODO this should not be a failure, I need to makea RepeatCondition node
    if (destination.hits >= destination.hitsMax) {
      return SUCCESS;
    }

    const result = creep.repair(destination);
    if (result != OK) {
      return FAILURE;
    }

    return RUNNING;
  },
);

const behavior = behaviorTree.sequenceNode(
  'repair',
  [
    behaviorAssign.moveToRoom,
    behaviorCommute.setCommuteDuration,
    behaviorRoom.getEnergy,
    behaviorTree.repeatUntilConditionMet(
      'repair_until_empty',
      (creep, trace, kingdom) => {
        if (creep.store.getUsedCapacity() === 0) {
          return true;
        }

        return false;
      },
      behaviorTree.sequenceNode(
        'select_and_repair',
        [
          selectStructureToRepair,
          behaviorMovement.moveToDestination(1, false, 50, 1000),
          repair,
        ],
      ),
    ),
  ],
);

export const roleRepairer = {
  run: behaviorTree.rootNode('repairer', behaviorBoosts(behaviorNonCombatant(behavior))),
};
