import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCrontab, parseEvery, renderCronBlock, renderLaunchd, renderSchtasks, renderSystemd } from '../src/schedule/jobs.ts';
import { isDispatchError } from '../src/errors.ts';
import type { JobSpec } from '../src/schedule/jobs.ts';

const SPEC: JobSpec = {
  command: ['/opt/node 24/bin/node', '/opt/dd/dist/cli/bin.js', 'podcast', 'run', '--if-due'],
  everyMinutes: 15,
  logFile: '/home/u/.local/state/daily-dispatch/podcast.log',
  path: '/usr/local/bin:/usr/bin:/bin',
};

test('parseEvery: minutes and hours, within 1 minute to 24 hours', () => {
  assert.equal(parseEvery('15m'), 15);
  assert.equal(parseEvery('1h'), 60);
  assert.equal(parseEvery('90m'), 90);
  for (const bad of ['0m', '15', '15s', '25h', '-5m', 'm']) assert.throws(() => parseEvery(bad), (e) => isDispatchError(e, 'usage'), bad);
});

test('systemd: a oneshot service and a timer that fires every interval and catches up after sleep', () => {
  const { service, timer } = renderSystemd(SPEC);
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^ExecStart="\/opt\/node 24\/bin\/node" "\/opt\/dd\/dist\/cli\/bin.js" "podcast" "run" "--if-due"$/m);
  assert.match(service, /^Environment="PATH=\/usr\/local\/bin:\/usr\/bin:\/bin"$/m);
  assert.match(service, /^StandardOutput=append:\/home\/u\/.local\/state\/daily-dispatch\/podcast.log$/m);
  assert.match(timer, /^OnCalendar=\*:0\/15$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^WantedBy=timers.target$/m);
  assert.match(renderSystemd({ ...SPEC, everyMinutes: 120 }).timer, /^OnUnitActiveSec=120min$/m, 'intervals that do not divide an hour use a monotonic timer');
});

test('systemd: % is escaped, because systemd expands %-specifiers in ExecStart', () => {
  const { service } = renderSystemd({ ...SPEC, command: ['/n', '/a%b/bin.js'] });
  assert.match(service, /"\/a%%b\/bin.js"/);
});

test('cron: one marked block, shell-quoted, with % escaped and output appended to the log', () => {
  const block = renderCronBlock({ ...SPEC, command: ["/opt/it's/node", '/a%b.js', 'podcast'] });
  const lines = block.trim().split('\n');
  assert.equal(lines[0], '# >>> daily-dispatch podcast (managed by `daily-dispatch schedule`) >>>');
  assert.equal(lines.at(-1), '# <<< daily-dispatch podcast <<<');
  assert.equal(
    lines[1],
    "*/15 * * * * PATH='/usr/local/bin:/usr/bin:/bin' '/opt/it'\\''s/node' '/a\\%b.js' 'podcast' >> '/home/u/.local/state/daily-dispatch/podcast.log' 2>&1",
  );
  assert.match(renderCronBlock({ ...SPEC, everyMinutes: 120 }), /^0 \*\/2 \* \* \* /m);
  assert.throws(() => renderCronBlock({ ...SPEC, everyMinutes: 25 }), (e) => isDispatchError(e, 'usage') && /cron/.test(e.message));
});

test('cron: installing replaces our block and leaves every other line alone; uninstall removes only ours', () => {
  const block = renderCronBlock(SPEC);
  const theirs = 'MAILTO=me\n0 5 * * * /usr/bin/backup\n';
  const once = mergeCrontab(theirs, block);
  assert.ok(once.startsWith(theirs));
  assert.equal(mergeCrontab(once, block), once, 'reinstalling is idempotent');
  const changed = mergeCrontab(once, renderCronBlock({ ...SPEC, everyMinutes: 30 }));
  assert.equal(changed.match(/daily-dispatch podcast \(managed/g)?.length, 1);
  assert.match(changed, /^\*\/30 /m);
  assert.equal(mergeCrontab(changed, null), theirs);
  assert.equal(mergeCrontab('', null), '');
});

test('launchd: a LaunchAgent plist with the interval in seconds and XML-escaped arguments', () => {
  const plist = renderLaunchd({ ...SPEC, command: ['/n', '/a&b<c>.js'] }, 'dev.daily-dispatch.podcast');
  assert.match(plist, /<key>Label<\/key>\s*<string>dev\.daily-dispatch\.podcast<\/string>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  assert.match(plist, /<string>\/a&amp;b&lt;c&gt;\.js<\/string>/);
  assert.match(plist, /<key>StandardOutPath<\/key>\s*<string>\/home\/u\/\.local\/state\/daily-dispatch\/podcast\.log<\/string>/);
  assert.match(plist, /<key>PATH<\/key>\s*<string>\/usr\/local\/bin:\/usr\/bin:\/bin<\/string>/);
});

test('schtasks: a Task Scheduler definition that repeats, never overlaps, and logs through --log', () => {
  const xml = renderSchtasks({ ...SPEC, command: ['C:\\Program Files\\nodejs\\node.exe', 'C:\\dd\\bin.js', 'podcast', 'run', '--if-due'], logFile: 'C:\\Users\\u\\dd.log' });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-16"\?>/);
  assert.match(xml, /<Interval>PT15M<\/Interval>/);
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(xml, /<StartWhenAvailable>true<\/StartWhenAvailable>/);
  assert.match(xml, /<Command>"C:\\Program Files\\nodejs\\node\.exe"<\/Command>/);
  assert.match(xml, /<Arguments>"C:\\dd\\bin\.js" podcast run --if-due --log "C:\\Users\\u\\dd\.log"<\/Arguments>/);
});
