
/**
 * Harvester creep
 *
 * Early game harvesting creep. Used when there is no storage. Replaced by miners
 * when storage is available.
 *
 * TODO fix 3 ticks of no movement after putting energy into spawner/dropoff
 */
import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING} from "./lib.behaviortree";
import * as behaviorCommute from "./behavior.commute";
import behaviorStorage from "./behavior.storage";
import * as behaviorMovement from "./behavior.movement";
import {build, selectInfrastructureSites} from "./behavior.build";
import * as behaviorHarvest from "./behavior.harvest";
import {behaviorBoosts} from "./behavior.boosts";
import * as MEMORY from "./constants.memory";
import {commonPolicy} from "./lib.pathing_policies";
import {roadWorker} from "./behavior.logistics";

const behavior = behaviorTree.sequenceNode(
  'haul_energy',
  [
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_SOURCE_POSITION, 1, commonPolicy),
    behaviorCommute.setCommuteDuration,
    behaviorHarvest.harvest,
    behaviorTree.selectorNode(
      'dump_or_build_or_upgrade',
      [
        behaviorTree.repeatUntilFailure(
          'dump_until_no_dropoff',
          behaviorTree.sequenceNode(
            'dump_energy',
            [
              behaviorTree.leafNode(
                'fail_when_empty',
                (creep, trace, kingdom) => {
                  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    return SUCCESS;
                  }

                  return FAILURE;
                }
              ),
              behaviorStorage.selectRoomDropoff,
              behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 1, commonPolicy),
              behaviorTree.leafNode(
                'empty_creep',
                (creep, trace, kingdom) => {
                  const destination = Game.getObjectById<Id<Structure<StructureConstant>>>(creep.memory[MEMORY.MEMORY_DESTINATION]);
                  if (!destination) {
                    trace.log('no destination', {destination: creep.memory[MEMORY.MEMORY_DESTINATION]});
                    return SUCCESS;
                  }

                  const resource = Object.keys(creep.store).pop();
                  const result = creep.transfer(destination, resource as ResourceConstant);
                  trace.log('transfer', {result, resource});

                  if (result === ERR_FULL) {
                    // We still have energy to transfer, fail so we find another
                    // place to dump
                    return SUCCESS;
                  }
                  if (result === ERR_NOT_ENOUGH_RESOURCES) {
                    return SUCCESS;
                  }
                  if (creep.store.getUsedCapacity() === 0) {
                    return SUCCESS;
                  }
                  if (result != OK) {
                    return SUCCESS;
                  }

                  return RUNNING;
                },
              ),
            ],
          ),
        ),
        behaviorTree.leafNode(
          'succeed_when_empty',
          (creep, trace, kingdom) => {
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
              return SUCCESS;
            }

            return FAILURE;
          }
        ),
        behaviorTree.sequenceNode(
          'build_construction_site',
          [
            behaviorTree.leafNode(
              'skip_some',
              (creep, trace, kingdom) => {
                if (Game.time % 5) {
                  return FAILURE;
                }

                return SUCCESS;
              },
            ),
            selectInfrastructureSites,
            behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 3, commonPolicy),
            build,
          ],
        ),
        behaviorTree.leafNode(
          'succeed_when_empty',
          (creep, trace, kingdom) => {
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
              return SUCCESS;
            }

            return FAILURE;
          }
        ),
        behaviorTree.sequenceNode(
          'upgrade_controller',
          [
            behaviorTree.leafNode(
              'pick_room_controller',
              (creep, trace, kingdom) => {
                const baseConfig = kingdom.getCreepBaseConfig(creep);
                if (!baseConfig) {
                  return FAILURE;
                }

                const room = Game.rooms[baseConfig.primary];
                if (!room) {
                  return FAILURE;
                }

                if (!room.controller) {
                  return FAILURE;
                }

                behaviorMovement.setDestination(creep, room.controller.id);
                return behaviorTree.SUCCESS;
              },
            ),
            behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 3, commonPolicy),
            behaviorCommute.setCommuteDuration,
            behaviorTree.repeatUntilSuccess(
              'upgrade_until_empty',
              behaviorTree.leafNode(
                'upgrade_controller',
                (creep, trace, kingdom) => {
                  const result = creep.upgradeController(creep.room.controller);
                  trace.log("upgrade result", {result})

                  if (result == ERR_NOT_ENOUGH_RESOURCES) {
                    return behaviorTree.SUCCESS;
                  }

                  if (result != OK) {
                    return behaviorTree.SUCCESS;
                  }

                  return behaviorTree.RUNNING;
                },
              ),
            ),
          ],
        ),
      ],
    ),
  ],
);

export const roleHarvester = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(roadWorker(behavior))),
};
