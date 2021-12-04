
import * as _ from 'lodash';

import {Scheduler, Priorities} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import RoomRunnable from './runnable.room';
import {ColonyConfig} from './config';

export class RoomManager {
  id: string;
  scheduler: Scheduler;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('room_run');
    trace.log('room manager run');

    // If any defined colonies don't exist, run it
    // const shardConfig = kingdom.getShardConfig(Game.shard.name);
    const shardConfig = kingdom.getPlanner().getShardConfig();
    Object.values<ColonyConfig>(shardConfig).forEach((colony) => {
      const hasProcess = this.scheduler.hasProcess(colony.primary);
      if (hasProcess) {
        return;
      }

      trace.log('missing colony', {colony})

      this.scheduler.registerProcess(new Process(colony.primary, 'room', Priorities.RESOURCES,
        new RoomRunnable(colony.primary, this.scheduler)));
    });

    Object.entries(Game.rooms).forEach(([name, room]) => {
      const hasProcess = this.scheduler.hasProcess(name);
      if (hasProcess) {
        return;
      }

      if (!kingdom.getRoomByName(name)) {
        trace.log('not a room we assert within our domain', {name});
        return;
      }

      trace.log('room we assert domain over without process, starting', {name});

      this.scheduler.registerProcess(new Process(name, 'room', Priorities.RESOURCES,
        new RoomRunnable(name, this.scheduler)));
    });


    trace.end();

    return running();
  }
}
