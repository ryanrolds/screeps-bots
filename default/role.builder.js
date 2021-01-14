const behaviorTree = require('./lib.behaviortree');
const behaviorCommute = require('./behavior.commute');
const behaviorMovement = require('./behavior.movement');
const behaviorBuild = require('./behavior.build');
const behaviorAssign = require('./behavior.assign');
const behaviorRoom = require('./behavior.room');
const behaviorNonCombatant = require('./behavior.noncombatant');

const behavior = behaviorTree.sequenceNode(
  'builder_root',
  [
    behaviorAssign.moveToRoom,
    behaviorCommute.setCommuteDuration,
    behaviorRoom.getEnergy,
    behaviorTree.repeatUntilSuccess(
      'build_until_empty',
      behaviorTree.sequenceNode(
        'build_construction_site',
        [
          behaviorBuild.selectSite,
          behaviorMovement.moveToDestinationRoom,
          behaviorMovement.moveToDestination(1),
          behaviorBuild.build,
        ],
      ),
    ),
  ],
);

module.exports = {
  id: 'builder',
  run: behaviorTree.rootNode(this.id, behaviorNonCombatant(behavior)).tick
};
