/**
 * NP-PILOT-FIRST-014 §22 — out-of-process recovery probe.
 *
 * Each invocation is a SEPARATE OS PROCESS with a cold pool, a cold module graph and no
 * carried state. That is what makes R1 a real application restart rather than the no-op the
 * in-process test used to perform.
 *
 * Commands:
 *   seed    - lay down one complete participation (consent, enrolment, activity)
 *   digest  - print sha256 over the reconstructed participation + control history
 *   export  - print sha256 over the participant export
 *   exit    - withdraw the participant, so the lifecycle ledger has something to lose
 *   ledger  - print the lifecycle-ledger row count (the positive control for R6)
 *   damage  - delete the lifecycle ledger, to drive R6
 *
 * It prints ONE line: <command>=<sha256>. Nothing else goes to stdout.
 */
import { createHash } from 'node:crypto';
import { closePool, query } from '../src/db/pool';
import { closeRedis } from '../src/cache/redis';
import { runMigrations } from '../src/db/migrate';
import { sqlPilotRepository as repo } from '../src/pilot/repository';
import { readBackParticipation, readBackPilotControl } from '../src/pilot/readBack';
import { exportParticipantPilotData } from '../src/pilot/export';
import { enroll, recordEvent, withdraw } from '../src/pilot/service';

const U = 'dddddddd-0000-4000-8000-0000000000e1';
const TERMS = { version: 'NP014-R-TERMS-v1', digest: 'NP014-R-DIGEST' };
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function seed() {
  await runMigrations();
  await query(`TRUNCATE pilot_cap_decisions, pilot_monitor_events, pilot_lifecycle_events,
               pilot_events, human_decisions, pilot_enrollments, consents, pilot_terms
               RESTART IDENTITY CASCADE`);
  await query('DELETE FROM pilot_control');
  await query('INSERT INTO pilot_control (id, stopped, max_participants) VALUES (true, false, 10)');
  await query("INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x') ON CONFLICT (id) DO NOTHING",
    [U, `${U}@np014.invalid`]);
  const { rows } = await query(
    `INSERT INTO pilot_terms (version, status, digest, content_reference, published_at)
     VALUES ($1,'PUBLISHED',$2,'NP-014 R-fixture', now()) RETURNING *`, [TERMS.version, TERMS.digest]);
  const t = rows[0];
  await repo.recordConsent(U, TERMS.version, {
    id: t.id, version: t.version, status: 'PUBLISHED', digest: t.digest,
    contentReference: t.content_reference, publishedAt: t.published_at,
  });
  await enroll({ repo }, U);
  await recordEvent({ repo }, U, 'session_started', {});
}

async function main() {
  const cmd = process.argv[2];
  let out = '';
  if (cmd === 'seed') { await seed(); out = 'seeded'; }
  else if (cmd === 'digest') {
    const p = await readBackParticipation(repo, U);
    const c = await readBackPilotControl(repo);
    out = sha({ participation: p, control: c });
    if (p.deviations.length || c.deviations.length)
      out += ' DEVIATIONS=' + JSON.stringify([...p.deviations, ...c.deviations]);
    out += ' STATUS=' + p.status;
  }
  else if (cmd === 'export') { out = sha(await exportParticipantPilotData(repo, U)); }
  else if (cmd === 'exit') { await withdraw({ repo }, U, 'NP-014 R6 exit'); out = 'exited'; }
  else if (cmd === 'ledger') {
    const { rows } = await query<{ n: number }>('SELECT count(*)::int AS n FROM pilot_lifecycle_events');
    out = String(rows[0].n);
  }
  else if (cmd === 'damage') { await query('DELETE FROM pilot_lifecycle_events'); out = 'damaged'; }
  else throw new Error('unknown command: ' + String(cmd));
  console.log(`${cmd}=${out}`);
  await closePool(); await closeRedis();
}
main().catch((e) => { console.log(`${process.argv[2]}=ERROR ${String(e)}`); process.exit(1); });
