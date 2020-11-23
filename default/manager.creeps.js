const roleHarvesterV2 = require('role.harvester.v2');
const roleUpgraderV2 = require('role.upgrader.v2');
const roleBuilderV2 = require('role.builder.v2');
const roleRepairerV2 = require('role.repairer.v2');
const roleHaulerV2 = require('role.hauler.v2');
const roleDistributor = require('role.distributor');
const roleDefender = require('role.defender');
const roleClaimerV2 = require('role.claimer.v2');
const roleAttacker = require('role.attacker')

const { MEMORY_HARVEST, MEMORY_HARVEST_ROOM, MEMORY_WITHDRAW, MEMORY_WITHDRAW_ROOM, MEMORY_CLAIM,
    MEMORY_ROLE, MEMORY_ORIGIN, MEMORY_FLAG, MEMORY_ASSIGN_ROOM } = require('constants.memory')

const { WORKER_ATTACKER } = require('constants.creeps')


var WORKER_BUILDER = module.exports.WORKER_BUILDER = "builder"
var WORKER_HARVESTER = module.exports.WORKER_HARVESTER = "harvester"
var WORKER_REMOTE_HARVESTER = module.exports.WORKER_REMOTE_HARVESTER = "remote_harvester"
var WORKER_MINER = module.exports.WORKER_MINER = "miner"
var WORKER_UPGRADER = module.exports.WORKER_UPGRADER = "upgrader"
var WORKER_DEFENDER = module.exports.WORKER_DEFENDER = "defender"
var WORKER_REPAIRER = module.exports.WORKER_REPAIRER = "repairer"
var WORKER_HAULER = module.exports.WORKER_HAULER = "hauler"
var WORKER_DISTRIBUTOR = module.exports.WORKER_DISTRIBUTOR = "distributor"
var WORKER_CLAIMER = module.exports.WORKER_CLAIMER = "claimer"
var WORKER_EXPLORER = module.exports.WORKER_EXPLORER = "claimer"

const workerRoles = {
    [WORKER_HARVESTER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_REMOTE_HARVESTER]: [CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, WORK, MOVE, WORK, MOVE],
    [WORKER_MINER]: [WORK, WORK, WORK, CARRY, MOVE],
    [WORKER_BUILDER]: [CARRY, MOVE, WORK, MOVE, WORK],
    [WORKER_UPGRADER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_DEFENDER]: [MOVE, TOUGH, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    [WORKER_REPAIRER]: [CARRY, MOVE, CARRY, MOVE, WORK],
    [WORKER_HAULER]: [CARRY, MOVE, CARRY, MOVE, CARRY, MOVE],
    [WORKER_DISTRIBUTOR]: [CARRY, MOVE, CARRY, MOVE, CARRY, MOVE],
    [WORKER_CLAIMER]: [MOVE, CLAIM, MOVE],
    [WORKER_EXPLORER]: [MOVE, MOVE, RANGED_ATTACK],
    [WORKER_ATTACKER]: [MOVE, TOUGH, MOVE, TOUGH, MOVE, RANGED_ATTACK],
}

const buildOrder = [WORKER_UPGRADER]

const desiredBuildersPerBuild = 1
const desiredDefendersPerRoom = 0

module.exports.spawnSuicide = (state, limits) => {
    // Manage the bar at which we build creeps
    let maxEnergy = Game.spawns['Spawn1'].room.energyCapacityAvailable
    let minEnergy = 300

    // Distributors
    const numExtensions = Game.spawns['Spawn1'].room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            return structure.structureType === STRUCTURE_EXTENSION
        }
    }).length
    if (numExtensions > 10) {
        minEnergy = maxEnergy * 0.6
    }
    if (numExtensions > 20) {
        minEnergy = maxEnergy * 0.7
    }

    let currentEnergy = Game.spawns['Spawn1'].room.energyAvailable

    console.log(`==== Energy - Current: ${currentEnergy}, Min-Build: ${minEnergy}, Max-Build: ${maxEnergy}`)

    let currentWorkers = _.countBy(Game.creeps, (creep) => {
        return creep.memory.role
    })
    console.log("==== Creeps:", JSON.stringify(currentWorkers))

    if (!Game.spawns['Spawn1'].spawning && currentEnergy >= minEnergy) {
        const containersAndStorage = Game.spawns['Spawn1'].room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_CONTAINER ||
                    structure.structureType == STRUCTURE_STORAGE);
            }
        }).length

        if (containersAndStorage) {
            let desiredDistributors = Math.floor(numExtensions * 0.1)
            if ((currentWorkers[WORKER_DISTRIBUTOR] || 0) < desiredDistributors) {
                let result = createCreep(WORKER_DISTRIBUTOR, currentEnergy, {})
                if (result != OK) {
                    console.log("problem creating distributor", result)
                }

                return
            }
        }

        // Check that all sources have a harvester and hauler if needed
        const energySources = state.sources.energy
        let energySourceIDs = Object.keys(state.sources.energy)

        // Sort the spawning room sources to the front
        energySourceIDs = _.sortBy(energySourceIDs, (sourceID) => {
            return Game.spawns['Spawn1'].room.name == state.sources.energy[sourceID].roomID ? 0 : 9999
        })

        // Iterate energy sources and ensure they are staffed
        for (let i = 0; i < energySourceIDs.length; i++) {
            let source = energySources[energySourceIDs[i]]

            let desiredHarvesters = 2
            let desiredMiners = 0
            let desiredHaulers = 0

            // Optimize energy collection - dedicated miners and haulers
            if (source.containerID) {
                desiredHarvesters = 0
                desiredMiners = 1
                desiredHaulers = 1

                let container = Game.getObjectById(source.containerID)
                if (container && container.store.getUsedCapacity() > 1500) {
                    //desiredHaulers = 2
                }
            }

            // We need at least twice as many haulers and more harvesters if the source
            // is in another room
            const differentRoom = Game.spawns['Spawn1'].room.name !== source.roomID
            //if (differentRoom) {
            //    desiredHarvesters = desiredHarvesters * 1.5
            //    desiredHaulers = Math.ceil(desiredHaulers * 1.4)
            //}

            if (source.numHarvesters < desiredHarvesters) {
                let harvesterType = WORKER_HARVESTER
                if (differentRoom) {
                    harvesterType = WORKER_REMOTE_HARVESTER
                }

                let result = createCreep(harvesterType, currentEnergy, {
                    [MEMORY_HARVEST]: source.id,
                    [MEMORY_HARVEST_ROOM]: source.roomID
                })
                if (result != OK) {
                    console.log("problem creating harvester", result)
                }

                return
            }

            if (source.numMiners < desiredMiners) {
                let result = createCreep(WORKER_MINER, currentEnergy, {
                    [MEMORY_HARVEST]: source.id,
                    [MEMORY_HARVEST_ROOM]: source.roomID
                })
                if (result != OK) {
                    console.log("problem creating miner", result)
                }

                return
            }

            if (source.numHaulers < desiredHaulers) {
                let result = createCreep(WORKER_HAULER, currentEnergy, {
                    [MEMORY_WITHDRAW]: source.containerID,
                    [MEMORY_WITHDRAW_ROOM]: source.roomID
                })
                if (result != OK) {
                    console.log("problem creating hauler", result)
                }

                return
            }
        }

        // We should always have an upgrader
        if ((currentWorkers[WORKER_UPGRADER] || 0) < 1) {
            let result = createCreep(WORKER_UPGRADER, currentEnergy, {})
            if (result != OK) {
                console.log("problem creating hauler", result)
            }

            return
        }

        let roomIDs = Object.keys(state.rooms)
        // Iterate rooms and ensure they are staffed
        for (let i = 0; i < roomIDs.length; i++) {
            let room = state.rooms[roomIDs[i]]

            // We need repairers if we have structures that decay
            if (room.hasStructures) {
                let desiredRepairers = 0

                if (room.hitsPercentage < 0.8) {
                    desiredRepairers = 1
                }

                if (room.hitsPercentage < 0.5) {
                    desiredRepairers = 2
                }

                if (room.numRepairers < desiredRepairers) {
                    let result = createCreep(WORKER_REPAIRER, currentEnergy, {
                        [MEMORY_ASSIGN_ROOM]: room.id
                    })
                    if (result != OK) {
                        console.log("problem creating repairer", result)
                    }

                    return
                }
            }

            if (room.numDefenders < desiredDefendersPerRoom) {
                let result = createCreep(WORKER_DEFENDER, currentEnergy, {
                    [MEMORY_ASSIGN_ROOM]: room.id
                })
                if (result != OK) {
                    console.log("problem creating defender", result)
                }

                return
            }
        }

        // Explore
        const roomsToExplore = state.explore
        const exploreRoomIDs = Object.keys(roomsToExplore)
        for (let i = 0; i < exploreRoomIDs.length; i++) {
            let explore = roomsToExplore[exploreRoomIDs[i]]
            if (!explore.hasExplorer) {
                let result = createCreep(WORKER_EXPLORER, currentEnergy, {
                    [MEMORY_CLAIM]: explore.id
                })
                if (result != OK) {
                    console.log("problem creating claimer", result)
                }

                return
            }
        }

        console.log("xxxxx", JSON.stringify(state.warParties))
        const warPartyIDs =  Object.keys(state.warParties)
        for (let i = 0; i < warPartyIDs.length; i++) {
            let warParty = state.warParties[warPartyIDs[i]]
            console.log("xxxxxxwar party", JSON.stringify(warParty))
            if (warParty.numAttackers < 1) {
                let result = createCreep(WORKER_ATTACKER, currentEnergy, {
                    [MEMORY_FLAG]: warParty.id
                })
                if (result != OK) {
                    console.log("problem creating attacker", result)
                }

                return
            }
        }

        // Iterate build and ensure they are staffed
        for (let i = 0; i < state.builds.length; i++) {
            let build = state.builds[i]
            if (!build.accessible) {
                console.log("build site not accessible", build.id)
                continue
            }

            let desiredBuilders = Math.ceil(build.numSites / 10)

            // Don't spawn builders if nothing to build
            if (build.hasSites) {
                if (build.numBuilders < desiredBuilders) {
                    let result = createCreep(WORKER_BUILDER, currentEnergy, {
                        [MEMORY_FLAG]: build.id
                    })
                    if (result != OK) {
                        console.log("problem creating builder", result)
                    }

                    return
                }
            }
        }

        // Maintain desired number of specific roles
        for (let i = 0; i < buildOrder.length; i++) {
            let role = buildOrder[i]
            let max = limits[role]
            let count = currentWorkers[role] || 0
            if (count < max) {
                let result = createCreep(role, currentEnergy)
                if (result != OK) {
                    console.log("problem creating", role, result)
                }

                return
            } if (count > max * 2) {
                suicideWorker(role)
                return
            }
        }
    }

    if (Game.spawns['Spawn1'].spawning) {
        var spawningCreep = Game.creeps[Game.spawns['Spawn1'].spawning.name];
        Game.spawns['Spawn1'].room.visual.text(
            '🛠️' + spawningCreep.memory.role,
            Game.spawns['Spawn1'].pos.x + 1,
            Game.spawns['Spawn1'].pos.y,
            {align: 'left', opacity: 0.8});
    }
}

module.exports.tick = (trace) => {
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        //console.log(creep.name, creep.memory.role)

        if (creep.spawning) {
            return
        }

        if (creep.memory.role == WORKER_ATTACKER) {
            roleAttacker.run(creep, trace)
        }

        if (creep.memory.role == WORKER_HARVESTER || creep.memory.role == WORKER_REMOTE_HARVESTER ||
            creep.memory.role == WORKER_MINER) {
            roleHarvesterV2.run(creep, trace)
        }

        if (creep.memory.role == WORKER_UPGRADER) {
            roleUpgraderV2.run(creep, trace)
        }

        if (creep.memory.role == WORKER_BUILDER) {
            roleBuilderV2.run(creep, trace);
        }

        if (creep.memory.role == WORKER_DEFENDER) {
            roleDefender.run(creep, trace);
        }

        if (creep.memory.role == WORKER_REPAIRER) {
            roleRepairerV2.run(creep, trace)
        }

        if (creep.memory.role == WORKER_HAULER) {
            roleHaulerV2.run(creep, trace)
        }

        if (creep.memory.role == WORKER_CLAIMER || creep.memory.role == WORKER_EXPLORER) {
            roleClaimerV2.run(creep, trace)
        }

        if (creep.memory.role == WORKER_DISTRIBUTOR) {
            roleDistributor.run(creep, trace)
        }
    }

    // Cleanup old creep memory
    for(var i in Memory.creeps) {
        if (!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
}

function createCreep(role, maxEnergy, memory = {}) {
    var parts = getBodyParts(role, maxEnergy)
    var name = role + '_' + Game.time;
    memory[MEMORY_ROLE] = role
    memory[MEMORY_ORIGIN] = Game.spawns['Spawn1'].room.name
    console.log(`==== Creating creep ${role}, ${parts}, ${memory}`)
    return Game.spawns['Spawn1'].spawnCreep(parts, name, {memory});
}

function getBodyParts(role, maxEnergy) {
    let roleDef = workerRoles[role]
    let parts = roleDef

    let i = 0
    let total = 0

    while (true) {
        let nextPart = roleDef[i % roleDef.length]
        let estimate = parts.concat([nextPart]).reduce((acc, part) => {
            return acc + BODYPART_COST[part]
        }, 0)

        //console.log("estiamte", estimate, maxEnergy)

        if (estimate < maxEnergy && parts.length <= 50) {
            parts.push(nextPart)
            total = estimate

            // console.log("under estimated parts", parts, estimate, maxEnergy)
        } else {
            // console.log("over estimated parts", parts, estimate, maxEnergy)
            break
        }

        i++
    }

    console.log("using parts for", role, parts, total, maxEnergy)

    return parts
}

function suicideWorker(role) {
    for (let name in Game.creeps) {
        let creep = Game.creeps[name];
        if (creep.memory.role === role) {
            console.log('Suiciding creep:', creep.name);
            creep.suicide()
            break
        }
    }
}
