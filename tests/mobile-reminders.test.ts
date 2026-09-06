import {test} from 'node:test';import assert from 'node:assert/strict';
import {classStart,dueReminderDays} from '../lib/mobile/reminders';
test('SGT normalized across source formats',()=>{assert.equal(classStart('20260910','0900')?.toISOString(),'2026-09-10T01:00:00.000Z');assert.equal(classStart('2026-09-10','09:00')?.toISOString(),'2026-09-10T01:00:00.000Z');assert.equal(classStart('junk','0900'),null)});
test('only 3 day and 1 day windows, safe catchup',()=>{const start=new Date('2026-09-10T01:00:00Z');assert.deepEqual(dueReminderDays(start,new Date('2026-09-07T01:05:00Z')),[3]);assert.deepEqual(dueReminderDays(start,new Date('2026-09-09T01:05:00Z')),[1]);assert.deepEqual(dueReminderDays(start,new Date('2026-09-08T01:05:00Z')),[]);assert.deepEqual(dueReminderDays(start,new Date('2026-09-09T02:00:00Z')),[])});

test('unpublished time never generates a reminder',()=>{assert.equal(classStart('2026-09-10',null),null)});
