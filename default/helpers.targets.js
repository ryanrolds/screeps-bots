const { numEnemeiesNearby } = require('helpers.proximity')

module.exports.getEnergyStorageTargets = (creep) => {
    let targets = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            return (
                (structure.structureType == STRUCTURE_EXTENSION &&
                    structure.store.getUsedCapacity(RESOURCE_ENERGY) >= 50) ||
                (structure.structureType == STRUCTURE_SPAWN &&
                    structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0)
            )
        }
    })

    if (!targets || !targets.length) {
        return null
    }

    return getClosestTarget(creep, targets)
}

module.exports.getEnergyContainerTargets = (creep) => {
    let targets = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            return (
                (structure.structureType == STRUCTURE_CONTAINER &&
                    structure.store.getUsedCapacity(RESOURCE_ENERGY) >= creep.store.getCapacity())
            )
        }
    })

    if (!targets || !targets.length) {
        return null
    }

    return getClosestTarget(creep, targets)
}

module.exports.getEnergyReserveTarget = (creep) => {
    var target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (structure) => {
            return (structure.structureType == STRUCTURE_EXTENSION ||
                    structure.structureType == STRUCTURE_SPAWN ||
                    structure.structureType == STRUCTURE_TOWER) &&
                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        }
    });

    console.log(target)

    if (!target) {
        return null
    }

    return target
}

module.exports.getEnergySource = (creep) => {
    var sources = creep.room.find(FIND_SOURCES, {
        filter: (source) => {
            // Don't send creeps to enemy covered soruces
            if (numEnemeiesNearby(source.pos, 5)) {
                return false
            }

            // Don't send creeps to low energy sources
            if (source.energy < 100) {
                return false
            }

            return true
        }
    })

    if (!sources || !sources.length) {
        return null
    }

    return getClosestTarget(creep, sources)
}

module.exports.getFullestContainer = (creep) => {
    var containers = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            return structure.structureType == STRUCTURE_CONTAINER &&
                structure.store.getUsedCapacity() > 0
        }
    })

    containers = _.sortBy(containers, (container) => {
        return container.store.getUsedCapacity()
    })

    return container[0]
}

const getClosestTarget = module.exports.getClosestTarget = (creep, targets) => {
    targets = _.sortBy(targets, (target) => {
        let result = PathFinder.search(creep.pos, {pos: target.pos})
        if (result.incomplete) {
            return 99999
        }

        return result.cost
    })

    if (!targets || !targets.length) {
        return null
    }

    return targets.pop()
}
