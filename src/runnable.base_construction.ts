import {BaseConfig} from "./config";
import {ANY, buildingCodes, EMPTY, getConstructionPosition} from "./lib.layouts";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import {sleeping} from "./os.process";
import {RunnableResult} from "./os.runnable";

const CONSTRUCTION_INTERVAL = 50;

export type BaseLayout = {
  origin: {x: number, y: number};
  parking: {x: number, y: number};
  buildings: string[][];
}

export const baseLayouts: BaseLayout[] = [
  { // RCL0
    origin: {x: 0, y: 0},
    parking: {x: 0, y: 0},
    buildings: []
  },
  { // RCL1
    origin: {x: 0, y: 4},
    parking: {x: 0, y: 0},
    buildings: [
      ['P'],
      ['.'],
      ['.'],
      ['.'],
      ['.'],
    ]
  },
  { // RCL2
    origin: {x: 2, y: 5},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', '.', 'R', 'E', '.'],
      ['E', 'R', 'P', 'R', 'E'],
      ['E', 'R', 'C', 'R', 'E'],
      ['X', 'R', 'C', 'R', 'X'],
      ['R', 'X', 'R', 'X', 'R'],
      ['.', 'R', 'X', 'R', '.'],
      ['.', '.', 'R', '.', '.'],
    ]
  },
  { // RCL3
    origin: {x: 2, y: 5},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', 'E', 'R', 'E', '.'],
      ['E', 'R', 'P', 'R', 'E'],
      ['E', 'R', 'C', 'R', 'E'],
      ['E', 'R', 'C', 'R', 'E'],
      ['R', 'T', 'R', 'E', 'R'],
      ['.', 'R', 'X', 'R', '.'],
      ['.', 'E', 'R', 'X', '.'],
    ]
  },
  { // RCL4
    origin: {x: 3, y: 6},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', 'E', 'R', 'E', 'R', 'E', '.'],
      ['.', 'R', 'E', 'R', 'E', 'R', '.'],
      ['.', 'E', 'R', 'P', 'R', 'E', '.'],
      ['.', 'E', 'R', 'C', 'R', 'E', '.'],
      ['.', 'X', 'R', 'C', 'R', 'E', '.'],
      ['.', 'R', 'T', 'R', 'E', 'R', '.'],
      ['.', 'X', 'R', 'S', 'R', 'X', '.'],
      ['.', 'R', 'E', 'R', 'E', 'R', '.'],
      ['.', 'X', 'R', 'X', 'R', 'R', '.'],
      ['.', 'E', 'R', 'E', 'R', 'R', '.'],
      ['.', 'E', 'R', 'X', 'R', 'R', '.'],
      ['.', 'R', 'E', 'R', 'E', 'R', '.'],
      ['.', 'E', 'R', 'E', 'R', '.', '.'],
    ]
  },
  { // RCL5
    origin: {x: 3, y: 6},
    parking: {x: 3, y: 3},
    buildings: [
      ['E', 'E', 'R', 'E', 'R', 'E', 'E'],
      ['R', 'R', 'E', 'R', 'E', 'R', 'R'],
      ['E', 'E', 'R', 'P', 'R', 'E', 'E'],
      ['E', 'E', 'R', 'E', 'R', 'E', 'E'],
      ['.', 'X', 'R', 'X', 'R', 'X', '.'],
      ['.', 'R', 'T', 'R', 'E', 'R', '.'],
      ['R', 'X', 'R', 'S', 'R', 'L', 'R'],
      ['.', 'R', 'E', 'R', 'T', 'R', '.'],
      ['.', 'X', 'R', 'X', 'R', 'R', 'R'],
      ['E', 'E', 'R', 'E', 'R', 'R', 'X'],
      ['E', 'E', 'R', 'X', 'R', 'R', 'R'],
      ['R', 'R', 'E', 'R', 'E', 'R', 'R'],
      ['E', 'E', 'R', 'E', 'R', 'E', 'E'],
    ]
  },
  { // RCL6
    origin: {x: 6, y: 7},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', '.', '.'],
      ['.', '.', 'R', 'E', 'E', 'R', 'P', 'R', 'E', 'E', 'R', '.', '.'],
      ['.', '.', 'E', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', '.', '.'],
      ['.', '.', 'E', 'B', 'B', 'R', 'X', 'R', 'X', 'X', 'E', '.', '.'],
      ['.', '.', 'R', 'B', 'R', 'T', 'R', 'E', 'R', 'X', 'R', '.', '.'],
      ['.', '.', '.', 'R', 'M', 'R', 'S', 'R', 'L', 'R', '.', '.', '.'],
      ['.', '.', 'R', 'X', 'R', 'E', 'R', 'T', 'R', 'X', 'R', '.', '.'],
      ['.', '.', 'E', 'X', 'X', 'R', 'X', 'R', 'R', 'R', 'R', '.', '.'],
      ['.', '.', 'E', 'E', 'E', 'R', 'E', 'R', 'R', 'X', 'R', '.', '.'],
      ['.', '.', 'R', 'E', 'E', 'R', 'X', 'R', 'R', 'R', 'R', '.', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ]
  },
  { // RCL7
    origin: {x: 6, y: 7},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', '.', '.'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'E', 'E', 'R', 'E', '.'],
      ['.', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', 'R', '.'],
      ['.', 'R', 'E', 'B', 'B', 'R', 'X', 'R', 'B', 'B', 'E', 'R', '.'],
      ['.', 'E', 'R', 'B', 'R', 'T', 'R', 'X', 'R', 'B', 'R', 'E', '.'],
      ['.', 'R', 'E', 'R', 'M', 'R', 'S', 'R', 'L', 'R', 'E', 'R', '.'],
      ['.', 'E', 'R', 'X', 'R', 'T', 'R', 'T', 'R', 'E', 'R', 'E', '.'],
      ['.', 'R', 'E', 'X', 'X', 'R', 'X', 'R', 'R', 'R', 'R', 'R', '.'],
      ['.', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'R', 'X', 'R', 'R', '.'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'R', 'R', 'R', 'E', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ]
  },
  { // RCL8
    origin: {x: 6, y: 7},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'O', 'R', 'E', 'E', '.', '.', '.'],
      ['.', 'E', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', 'E', '.'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'E', 'E', 'R', 'E', '.'],
      ['E', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', 'R', 'E'],
      ['E', 'R', 'E', 'B', 'B', 'R', 'T', 'R', 'B', 'B', 'E', 'R', 'E'],
      ['R', 'E', 'R', 'B', 'R', 'T', 'R', 'T', 'R', 'B', 'R', 'E', 'R'],
      ['E', 'R', 'E', 'R', 'M', 'R', 'S', 'R', 'L', 'R', 'P', 'R', 'E'],
      ['R', 'E', 'R', 'B', 'R', 'T', 'R', 'T', 'R', 'X', 'R', 'E', 'R'],
      ['E', 'R', 'E', 'B', 'B', 'R', 'T', 'R', 'R', 'R', 'R', 'R', 'E'],
      ['E', 'R', 'E', 'E', 'N', 'R', 'E', 'R', 'R', 'X', 'R', 'R', 'E'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'R', 'R', 'R', 'E', '.'],
      ['.', 'E', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', 'E', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ]
  },
]

export default class BaseConstructionRunnable {
  id: string;
  orgRoom: OrgRoom;

  constructor(id: string, orgRoom: OrgRoom) {
    this.id = id;
    this.orgRoom = orgRoom;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('base_construction_run');

    trace.notice('base construction run', {id: this.id, orgRoomId: this.orgRoom.id});

    const roomLevel = this.orgRoom.getRoomLevel();
    if (roomLevel < 1) {
      trace.log('room level low', {roomLevel});
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const colony = this.orgRoom.getColony();
    if (!colony) {
      trace.end();
      return sleeping(50);
    }

    const isAutomated = colony.isAutomated();
    if (!isAutomated) {
      trace.log('not automated');
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const origin = colony.getOrigin();
    if (!origin) {
      trace.log('no origin');
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const room = this.orgRoom.getRoomObject();
    if (!room) {
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const layout = this.selectLayout(roomLevel, room, origin, trace);
    if (layout) {
      this.buildLayout(kingdom, layout, room, origin, trace);
      this.setParking(kingdom, layout, origin, room, trace);
    } else {
      trace.log('no layout');
    }

    const baseConfig = kingdom.getPlanner().getBaseConfigById(this.orgRoom.id);
    if (!baseConfig) {
      trace.log('no base config');
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    trace.notice('base config', {roomLevel, hasStorage: this.orgRoom.hasStorage, baseConfig});

    if (roomLevel > 3 && this.orgRoom.hasStorage) {
      this.buildWalls(kingdom, room, baseConfig, trace);
    }

    trace.end();
    return sleeping(CONSTRUCTION_INTERVAL);
  }

  selectLayout(roomLevel: number, room: Room, origin: RoomPosition, trace: Tracer): BaseLayout {
    //for (let i = 0; i <= roomLevel; i++) {
    //  const layout = baseLayouts[i];
    const layout = baseLayouts[roomLevel];
    if (!this.layoutComplete(layout, room, origin, trace)) {
      return layout;
    }
    //}

    return null;
  }

  buildLayout(kingdom: Kingdom, layout: BaseLayout, room: Room, origin: RoomPosition, trace: Tracer): void {
    trace.log('building layout', {roomId: room.name, layout});

    // const roomVisual = new RoomVisual(room.name);
    for (let y = 0; y < layout.buildings.length; y++) {
      const row = layout.buildings[y];
      for (let x = 0; x < row.length; x++) {
        const code = row[x];
        if (buildingCodes[code] === ANY) {
          continue;
        }

        const pos = getConstructionPosition({x, y}, origin, layout);

        const structure = pos.lookFor(LOOK_STRUCTURES)[0];
        if (structure) {
          trace.log('structure present', {structure: structure.structureType});

          if (structure.structureType !== buildingCodes[code]) {
            trace.notice('wrong site, remove', {existing: structure.structureType, expected: buildingCodes[code]});
            structure.destroy();
          }

          continue;
        }

        const site = pos.lookFor(LOOK_CONSTRUCTION_SITES)[0];
        if (site) {
          if (site.structureType !== buildingCodes[code]) {
            trace.notice('wrong site, remove', {existing: site.structureType, expected: buildingCodes[code]});
            site.remove();
          }

          continue;
        }

        const structureType = buildingCodes[code];
        if (!structureType || structureType === EMPTY) {
          continue;
        }

        // roomVisual.text(code, pos.x, pos.y);

        const result = room.createConstructionSite(pos, structureType);
        if (result !== OK && result !== ERR_FULL) {
          trace.error('failed to build structure', {structureType, pos, result});
        }
      }
    }
  }

  buildWalls(kingdom: Kingdom, room: Room, baseConfig: BaseConfig, trace: Tracer): void {
    if (!baseConfig.walls) {
      return;
    }

    trace.notice('building walls', {roomId: room.name});

    baseConfig.walls.forEach(wall => {
      const position = new RoomPosition(wall.x, wall.y, room.name)

      const road = position.lookFor(LOOK_STRUCTURES).find(structure => {
        return structure.structureType === STRUCTURE_ROAD;
      });

      let expectedStructure: (STRUCTURE_WALL | STRUCTURE_RAMPART) = STRUCTURE_WALL;
      if (road) {
        expectedStructure = STRUCTURE_RAMPART;
      }

      const structure = position.lookFor(LOOK_STRUCTURES).find(structure => {
        return structure.structureType === expectedStructure;
      });
      if (structure) {
        trace.log('structure present', {structure: structure.structureType});
        return;
      }

      let foundSite = false;

      const sites = position.lookFor(LOOK_CONSTRUCTION_SITES)
      if (sites) {
        const expectedSite = sites.find(site => {
          return site.structureType === expectedStructure;
        });

        if (expectedSite) {
          trace.log('site present', {site: expectedSite.structureType});
          foundSite = true;
        } else {
          sites.forEach(site => {
            trace.log('wrong site, remove', {existing: site.structureType, expected: expectedStructure});
            site.remove();
          });
        }
      }

      if (!foundSite) {
        trace.log('building site', {wall, structureType: expectedStructure});
        const result = room.createConstructionSite(wall.x, wall.y, expectedStructure);
        if (result !== OK) {
          trace.error('failed to build structure', {result, pos: position, structureType: expectedStructure});
        }
      }
    });
  }

  setParking(kingdom: Kingdom, layout: BaseLayout, origin: RoomPosition, room: Room, trace: Tracer): void {
    const baseConfig = kingdom.getPlanner().getBaseConfigByRoom(room.name);
    if (!baseConfig) {
      trace.error('no base config when setting parking', {roomId: room.name});
      return null;
    }

    baseConfig.parking = new RoomPosition(layout.parking.x + origin.x, layout.parking.y + origin.y, room.name);
  }

  layoutComplete(layout: BaseLayout, room: Room, origin: RoomPosition, trace: Tracer): boolean {
    if (layout.buildings.length === 0) {
      return true;
    }

    for (let y = 0; y < layout.buildings.length; y++) {
      const row = layout.buildings[y];
      for (let x = 0; x < row.length; x++) {
        const pos = getConstructionPosition({x, y}, origin, layout);
        const structures = pos.lookFor(LOOK_STRUCTURES);

        const code = row[x];

        // Anything can be there
        if (buildingCodes[code] === ANY) {
          continue;
        }

        // No structures and empty
        if (buildingCodes[code] === EMPTY && !structures.length) {
          continue;
        }

        if (!structures.length) {
          trace.log('missing structures', {pos, building: buildingCodes});
          return false;
        }

        if (structures.length && structures[0].structureType !== buildingCodes[code]) {
          trace.log('incorrect structure present', {pos, structures: structures.map(s => s.structureType)});
          return false;
        }
      }
    }

    return true;
  }
}
