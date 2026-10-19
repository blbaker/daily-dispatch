import { DispatchError } from '../errors.ts';

/** What every scheduler runs: the same command line, on an interval, logging to one file. */
export interface JobSpec {
  /** argv: [node, cli script, "podcast", "run", "--if-due", ...]. Absolute paths, so no PATH lookup is needed. */
  command: readonly string[];
  everyMinutes: number;
  logFile: string;
  /** PATH captured at install time, so the job finds ffmpeg and any writer CLI. */
  path: string;
}

export const CRON_BEGIN = '# >>> daily-dispatch podcast (managed by `daily-dispatch schedule`) >>>';
export const CRON_END = '# <<< daily-dispatch podcast <<<';

/** "15m" or "1h" to minutes, 1 minute to 24 hours. */
export function parseEvery(s: string): number {
  const m = /^(\d+)([mh])$/.exec(s.trim());
  const minutes = m === null ? Number.NaN : Number(m[1]) * (m[2] === 'h' ? 60 : 1);
  if (!(minutes >= 1 && minutes <= 1440)) throw new DispatchError('usage', `--every "${s}" must look like 15m or 1h, between 1m and 24h`);
  return minutes;
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** systemd unit quoting: \ and " escaped, and % and $ doubled because systemd expands them. */
const unitQuote = (s: string): string => `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`;

export function renderSystemd(spec: JobSpec): { service: string; timer: string } {
  const n = spec.everyMinutes;
  const log = spec.logFile.replace(/%/g, '%%');
  const service = `[Unit]
Description=Daily Dispatch: make the daily podcast episode when it is due

[Service]
Type=oneshot
Environment=${unitQuote(`PATH=${spec.path}`)}
ExecStart=${spec.command.map(unitQuote).join(' ')}
StandardOutput=append:${log}
StandardError=append:${log}
`;
  // OnCalendar keeps wall-clock alignment and, with Persistent, catches up
  // after a suspend. Intervals that do not divide an hour fall back to a
  // monotonic timer.
  const when = n < 60 && 60 % n === 0 ? `OnCalendar=*:0/${n}\nPersistent=true` : `OnBootSec=2min\nOnUnitActiveSec=${n}min`;
  const timer = `[Unit]
Description=Daily Dispatch: check every ${n} minutes whether the podcast episode is due

[Timer]
${when}
Unit=daily-dispatch-podcast.service

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

/** POSIX shell single quotes; % escaped for cron, which turns a bare % into a newline. */
const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`.replace(/%/g, '\\%');

function cronTiming(n: number): string {
  if (n < 60 && 60 % n === 0) return `*/${n} * * * *`;
  if (n % 60 === 0 && 24 % (n / 60) === 0) return n === 60 ? '0 * * * *' : n === 1440 ? '0 0 * * *' : `0 */${n / 60} * * *`;
  throw new DispatchError('usage', `cron can only repeat at intervals that divide an hour or a day evenly (5m, 10m, 15m, 20m, 30m, 1h, 2h, ...), not ${n} minutes`);
}

export function renderCronBlock(spec: JobSpec): string {
  const line = `${cronTiming(spec.everyMinutes)} PATH=${shQuote(spec.path)} ${spec.command.map(shQuote).join(' ')} >> ${shQuote(spec.logFile)} 2>&1`;
  return `${CRON_BEGIN}\n${line}\n${CRON_END}\n`;
}

/** Replace (or with null, remove) our block in a crontab, leaving every other line as it was. */
export function mergeCrontab(existing: string, block: string | null): string {
  const lines = existing.split('\n');
  const start = lines.indexOf(CRON_BEGIN);
  const end = start === -1 ? -1 : lines.indexOf(CRON_END, start);
  const kept = start === -1 || end === -1 ? lines : [...lines.slice(0, start), ...lines.slice(end + 1)];
  let text = kept.join('\n');
  if (text !== '' && !text.endsWith('\n')) text += '\n';
  return block === null ? text : `${text}${block}`;
}

export function renderLaunchd(spec: JobSpec, label: string): string {
  const args = spec.command.map((a) => `    <string>${xml(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartInterval</key>
  <integer>${spec.everyMinutes * 60}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(spec.path)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(spec.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(spec.logFile)}</string>
</dict>
</plist>
`;
}

/** Windows command-line quoting for one argument (CommandLineToArgvW rules for the common cases). */
const winQuote = (s: string): string => (/^[A-Za-z0-9_\-=.:]+$/.test(s) ? s : `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`);

/**
 * Task Scheduler cannot redirect output, so the task passes --log and the
 * CLI appends to the log file itself. The file is written as UTF-16, which
 * is what `schtasks /Create /XML` expects.
 */
export function renderSchtasks(spec: JobSpec): string {
  const [exe = '', ...rest] = spec.command;
  const command = exe.includes(' ') ? `"${exe}"` : exe;
  const args = [...rest, '--log', spec.logFile].map(winQuote).join(' ');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Daily Dispatch: make the daily podcast episode when it is due</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT${spec.everyMinutes}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(command)}</Command>
      <Arguments>${xml(args)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}
