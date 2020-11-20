const roleHarvesterV2 = require('role.harvester.v2');
const roleUpgraderV2 = require('role.upgrader.v2');
const roleBuilderV2 = require('role.builder.v2');
const roleRepairerV2 = require('role.repairer.v2');
const roleHaulerV2 = require('role.hauler.v2');
const roleDefender = require('role.defender');
const roleClaimerV2 = require('role.claimer.v2');
const { MEMORY_HARVEST, MEMORY_HARVEST_ROOM, MEMORY_WITHDRAW, MEMORY_WITHDRAW_ROOM, MEMORY_CLAIM,
    MEMORY_ROLE, MEMORY_ORIGIN, MEMORY_FLAG, MEMORY_ASSIGN_ROOM } = require('helpers.memory')

var WORKER_BUILDER = module.exports.WORKER_BUILDER = "builder"
var WORKER_HARVESTER = module.exports.WORKER_HARVESTER = "harvester"
var WORKER_REMOTE_HARVESTER = module.exports.WORKER_REMOTE_HARVESTER = "remote_harvester"
var WORKER_MINER = module.exports.WORKER_MINER = "miner"
var WORKER_UPGRADER = module.exports.WORKER_UPGRADER = "upgrader"
var WORKER_DEFENDER = module.exports.WORKER_DEFENDER = "defender"
var WORKER_REPAIRER = module.exports.WORKER_REPAIRER = "repairer"
var WORKER_HAULER = module.exports.WORKER_HAULER = "hauler"
var WORKER_CLAIMER = module.exports.WORKER_CLAIMER = "claimer"
var WORKER_EXPLORER = module.exports.WORKER_EXPLORER = "claimer"

const workerRoles = {
    [WORKER_HARVESTER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_REMOTE_HARVESTER]: [CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, WORK, MOVE, WORK, MOVE],
    [WORKER_MINER]: [WORK, WORK, WORK, CARRY, MOVE],
    [WORKER_BUILDER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_UPGRADER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_DEFENDER]: [MOVE, TOUGH, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    [WORKER_REPAIRER]: [CARRY, CARRY, MOVE, WORK],
    [WORKER_HAULER]: [CARRY, CARRY, MOVE, MOVE],
    [WORKER_CLAIMER]: [MOVE, CLAIM, MOVE],
    [WORKER_EXPLORER]: [MOVE, MOVE, RANGED_ATTACK]
}

const buildOrder = [WORKER_UPGRADER]

const desiredBuildersPerBuild = 2
const desiredDefendersPerRoom = 1
const desiredRepairersPerRoom = 2

module.exports.spawnSuicide = (state, limits) => {
    // Manage the bar at which we build creeps
    let maxEnergy = Game.spawns['Spawn1'].room.energyCapacityAvailable
    let currentEnergy = Game.spawns['Spawn1'].room.energyAvailable
    let minEnergy = 300

    const numCreeps = Object.keys(Game.creeps).length
    if (numCreeps > 10) {
        minEnergy = maxEnergy * 0.75
    }
    if (numCreeps > 15) {
        minEnergy = maxEnergy * 0.8
    }
    if (numCreeps > 20) {
        minEnergy = maxEnergy * 0.9
    }

    console.log(`==== Energy - Current: ${currentEnergy}, Min-Build: ${minEnergy}, Max-Build: ${maxEnergy}`)

    let currentWorkers = _.countBy(Game.creeps, (creep) => {
        return creep.memory.role
    })
    console.log("==== Creeps:", JSON.stringify(currentWorkers))

    if (!Game.spawns['Spawn1'].spawning && currentEnergy >= minEnergy) {
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

            let desiredMiners = 3
            let desiredHaulers = 0

            if (source.containerID) {
                desiredMiners = 1
                desiredHaulers = 1

                let container = Game.getObjectById(source.containerID)
                if (container && container.store.getUsedCapacity() > 1500) {
                    desiredHaulers = 2
                }
            }

            const differentRoom = Game.spawns['Spawn1'].room.name !== source.roomID

            // We need at least twice as many workers if the source
            // is in another room
            if (differentRoom) {
                //desiredMiners = desiredMiners * 2
                //desiredHaulers = desiredHaulers * 2
            }

            if (source.numMiners < desiredMiners) {
                let harvesterType = WORKER_HARVESTER
                if (source.containerID) {
                    harvesterType = WORKER_MINER
                } else if (differentRoom) {
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

        // Iterate build and ensure they are staffed
        for (let i = 0; i < state.builds.length; i++) {
            let build = state.builds[i]
            if (!build.accessible) {
                console.log("build site not accessible", build.id)
                continue
            }

            if (build.numBuilders < desiredBuildersPerBuild) {
                let result = createCreep(WORKER_BUILDER, currentEnergy, {
                    [MEMORY_FLAG]: build.id
                })
                if (result != OK) {
                    console.log("problem creating hauler", result)
                }

                return
            }
        }

        let roomIDs = Object.keys(state.rooms)
        // Iterate rooms and ensure they are staffed
        for (let i = 0; i < roomIDs.length; i++) {
            let room = state.rooms[roomIDs[i]]

            // We need repairers if we have structures that decay
            if (room.hasStructures) {
                console.log("xxxxxxx has structures", room.id, room.numRepairers, desiredRepairersPerRoom)
                if (room.numRepairers < desiredRepairersPerRoom) {
                    let result = createCreep(WORKER_REPAIRER, currentEnergy, {
                        [MEMORY_ASSIGN_ROOM]: room.id
                    })
                    if (result != OK) {
                        console.log("problem creating repairer", result)
                    }

                    return
                }
            }

            // Don't spawn builders if nothing to build
            if (room.hasSites) {
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
                    return
                }
            }
        }

        /*
        // ====================================
        // Track ticks that the spawner is full and creates an upgraded if full for too long
        if (!Game.spawns['Spawn1'].memory.fullTicks) {
            Game.spawns['Spawn1'].memory.fullTicks = 0
        }

        if (currentEnergy >= maxEnergy) {
            Game.spawns['Spawn1'].memory.fullTicks++
        } else {
            Game.spawns['Spawn1'].memory.fullTicks = 0
        }

        console.log("upgrader", currentWorkers[WORKER_UPGRADER], limits[WORKER_UPGRADER])

        if (Game.spawns['Spawn1'].memory.fullTicks >= AUTO_BUILD_UPGRADER_FULL_TICKS &&
            (currentWorkers[WORKER_UPGRADER] < limits[WORKER_UPGRADER] * 2)) {
            console.log("Auto building upgrader")
            let result = createCreep(WORKER_UPGRADER, currentEnergy)
            if (result == ERR_NOT_ENOUGH_ENERGY) {
                Game.spawns['Spawn1'].memory.energyAvailable = false
            }

            return
        }
        // ====================================
        */
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

module.exports.tick = () => {
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        //console.log(creep.name, creep.memory.role)

        if (creep.spawning) {
            return
        }

        if (creep.memory.role == WORKER_HARVESTER || creep.memory.role == WORKER_REMOTE_HARVESTER ||
            creep.memory.role == WORKER_MINER) {
            roleHarvesterV2.run(creep)
        }

        if (creep.memory.role == WORKER_UPGRADER) {
            roleUpgraderV2.run(creep)
        }

        if (creep.memory.role == WORKER_BUILDER) {
            roleBuilderV2.run(creep);
        }

        if (creep.memory.role == WORKER_DEFENDER) {
            roleDefender.run(creep);
        }

        if (creep.memory.role == WORKER_REPAIRER) {
            roleRepairerV2.run(creep)
        }

        if (creep.memory.role == WORKER_HAULER) {
            roleHaulerV2.run(creep)
        }

        if (creep.memory.role == WORKER_CLAIMER || creep.memory.role == WORKER_EXPLORER) {
            roleClaimerV2.run(creep)
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
