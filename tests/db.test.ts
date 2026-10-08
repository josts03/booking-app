/**
 * Database tests: the migrations in supabase/migrations and the seed run in a
 * real Postgres (PGlite, in memory), then every rule of specs/security.md that
 * lives in the database is attacked as a visitor (anon), as a salon admin
 * (authenticated) and as a stranger with an account.
 *
 * Supabase's own parts (auth schema, roles) are recreated as stand-ins below,
 * the way a project created after 30. 5. 2026 has them: no automatic grants on
 * new tables, so the migrations must grant everything themselves. (On older
 * projects 003_rls.sql revokes the automatic grants first, which ends the same.)
 *
 * Not covered here: two truly simultaneous inserts (PGlite has one connection).
 * The exclusion constraint that decides that case is tested sequentially.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { buildFixtures, FIXTURE_SALON_ID } from "../lib/fixtures";
import { buildSeedSql } from "../scripts/seed-sql";

const NOW = new Date("2026-10-08T10:00:00Z");
const fixtures = buildFixtures(NOW);

const TEST = FIXTURE_SALON_ID; // "Frizerstvo Test", trial, from the seed
const OTHER = "0000000f-0000-4000-8000-000000000001"; // another open salon
const SUSPENDED = "0000000f-0000-4000-8000-000000000002";

const OWNER_TEST = "0000000a-0000-4000-8000-000000000001";
const OWNER_OTHER = "0000000a-0000-4000-8000-000000000002";
const STRANGER = "0000000a-0000-4000-8000-000000000003"; // has an account, no salon

const MAJA = fixtures.staff[0].id;
const LUKA = fixtures.staff[1].id;
const WOMENS_CUT = fixtures.services[1].id; // 45 min + 5 min buffer
const ANA = fixtures.customers[0].id;
const OTHER_STAFF = "0000000f-0000-4000-8000-000000000011";
const OTHER_SERVICE = "0000000f-0000-4000-8000-000000000021";
const OTHER_CUSTOMER = "0000000f-0000-4000-8000-000000000031";
const OTHER_BOOKING = "0000000f-0000-4000-8000-000000000041";

const db = new PGlite({ extensions: { btree_gist } });

type Role = "anon" | "authenticated" | "service_role" | "postgres";
type Params = unknown[];

/** Runs `fn` in a transaction as `role` (and Supabase user `userId`), then rolls everything back. */
async function as<T>(role: Role, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    if (role !== "postgres") await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

async function rows(sql: string, params: Params = []): Promise<Record<string, unknown>[]> {
  return (await db.query<Record<string, unknown>>(sql, params)).rows;
}

async function count(sql: string, params: Params = []): Promise<number> {
  return Number((await rows(sql, params))[0].count);
}

/** The Postgres error code of a statement, or "ok". Uses a savepoint, so the transaction goes on. */
async function outcome(sql: string, params: Params = []): Promise<string> {
  await db.exec("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.exec("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.exec("rollback to savepoint attempt");
    return (error as { code?: string }).code ?? String(error);
  }
}

async function affected(sql: string, params: Params = []): Promise<number> {
  return (await db.query(sql, params)).affectedRows ?? 0;
}

const DENIED = "42501"; // insufficient_privilege, also "violates row-level security policy"
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const CHECK = "23514";
const OVERLAP = "23P01"; // exclusion_violation

function insertBooking(opts: {
  salon?: string;
  staff?: string;
  service?: string;
  customer?: string;
  start: string; // local time on Monday 7. 1. 2030, "HH:MM"
  minutes?: number;
  buffer?: number;
  status?: string;
}): string {
  const start = `2030-01-07 ${opts.start}:00+01`;
  return `insert into bookings (salon_id, staff_id, service_id, customer_id, starts_at, ends_at, buffer_min, status, price_cents)
    values ('${opts.salon ?? TEST}', '${opts.staff ?? MAJA}', '${opts.service ?? WOMENS_CUT}', '${opts.customer ?? ANA}',
      timestamptz '${start}', timestamptz '${start}' + interval '${opts.minutes ?? 45} minutes',
      ${opts.buffer ?? 5}, '${opts.status ?? "confirmed"}', 3200)`;
}

before(async () => {
  // ---- Supabase stand-ins: auth schema, API roles and their default grants ----
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    -- "Enable automatic RLS" (project option): Supabase's event trigger that turns
    -- on RLS for every new table in public. Executable by everyone by default.
    create function public.rls_auto_enable() returns event_trigger
    language plpgsql security definer set search_path = '' as $$
    declare r record;
    begin
      for r in select * from pg_event_trigger_ddl_commands()
        where command_tag = 'CREATE TABLE' and schema_name = 'public' loop
        execute format('alter table %s enable row level security', r.object_identity);
      end loop;
    end $$;
    create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();
  `);

  // ---- the project's migrations, in order ----
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(file, dir), "utf8"));
  }

  // ---- the seed (same SQL `npm run seed` writes) ----
  await db.exec(buildSeedSql(NOW));

  // ---- two more salons and three users ----
  await db.exec(`
    insert into auth.users values ('${OWNER_TEST}'), ('${OWNER_OTHER}'), ('${STRANGER}');
    insert into salons (id, slug, name, subscription_status) values
      ('${OTHER}', 'drugi', 'Drugi salon', 'active'),
      ('${SUSPENDED}', 'izklopljen', 'Izklopljen salon', 'suspended');
    insert into salon_users (salon_id, user_id) values
      ('${TEST}', '${OWNER_TEST}'), ('${OTHER}', '${OWNER_OTHER}');
    insert into staff (id, salon_id, name, email, phone) values
      ('${OTHER_STAFF}', '${OTHER}', 'Bor', 'bor@zasebno.si', '031 999 999'),
      ('0000000f-0000-4000-8000-000000000012', '${SUSPENDED}', 'Zala', 'zala@zasebno.si', null);
    insert into services (id, salon_id, name, duration_min) values
      ('${OTHER_SERVICE}', '${OTHER}', 'Masaža', 60),
      ('0000000f-0000-4000-8000-000000000022', '${SUSPENDED}', 'Manikura', 45);
    insert into staff_hours (salon_id, staff_id, weekday, start_time, end_time) values
      ('${SUSPENDED}', '0000000f-0000-4000-8000-000000000012', 1, '09:00', '17:00');
    insert into time_off (salon_id, staff_id, starts_at, ends_at, reason) values
      ('${SUSPENDED}', '0000000f-0000-4000-8000-000000000012', '2030-01-07 08:00Z', '2030-01-08 08:00Z', 'Bolniška'),
      ('${OTHER}', '${OTHER_STAFF}', '2030-01-07 08:00Z', '2030-01-08 08:00Z', 'Zdravnik');
    insert into customers (id, salon_id, first_name, phone) values
      ('${OTHER_CUSTOMER}', '${OTHER}', 'Tuja stranka', '+38641555555');
    insert into bookings (id, salon_id, staff_id, service_id, customer_id, starts_at, ends_at, price_cents) values
      ('${OTHER_BOOKING}', '${OTHER}', '${OTHER_STAFF}', '${OTHER_SERVICE}', '${OTHER_CUSTOMER}',
       '2030-01-07 09:00Z', '2030-01-07 10:00Z', 4000);
  `);
});

describe("migrations and seed", () => {
  test("the seed loads the test salon exactly like lib/fixtures.ts", async () => {
    const where = `where salon_id = '${TEST}'`;
    assert.equal(await count(`select count(*) from staff ${where}`), fixtures.staff.length);
    assert.equal(await count(`select count(*) from services ${where}`), fixtures.services.length);
    assert.equal(await count(`select count(*) from staff_hours ${where}`), fixtures.staffHours.length);
    assert.equal(await count(`select count(*) from customers ${where}`), fixtures.customers.length);
    assert.equal(await count(`select count(*) from bookings ${where}`), fixtures.bookings.length);
    // The database's generated period (booking + buffer) equals the one the mock computes.
    for (const booking of fixtures.bookings.filter((b) => b.buffer_min > 0).slice(0, 5)) {
      const [row] = await rows(
        `select lower(period) = $2::timestamptz and upper(period) = $3::timestamptz as same
           from bookings where id = $1`,
        [booking.id, booking.starts_at, new Date(Date.parse(booking.ends_at) + booking.buffer_min * 60_000).toISOString()],
      );
      assert.equal(row.same, true, booking.id);
    }
  });

  test("the seed can run again and keeps the salon's users", async () => {
    await db.exec(buildSeedSql(NOW));
    assert.equal(await count(`select count(*) from bookings where salon_id = '${TEST}'`), fixtures.bookings.length);
    assert.equal(await count(`select count(*) from salon_users where salon_id = '${TEST}'`), 1);
  });
});

describe("visitor without login (anon)", () => {
  test("cannot read any private table", async () => {
    for (const table of [
      "customers",
      "bookings",
      "booking_notifications",
      "payments",
      "audit_log",
      "rate_limits",
      "salon_users",
    ]) {
      await as("anon", null, async () => {
        assert.equal(await outcome(`select 1 from ${table} limit 1`), DENIED, table);
      });
    }
  });

  test("cannot create customers or bookings (only the server action can)", async () => {
    await as("anon", null, async () => {
      assert.equal(
        await outcome(`insert into customers (salon_id, first_name, phone) values ('${TEST}', 'X', '+38640999999')`),
        DENIED,
      );
      assert.equal(await outcome(insertBooking({ start: "10:00" })), DENIED);
    });
  });

  test("sees staff names and absences, but no e-mail, phone or reason", async () => {
    await as("anon", null, async () => {
      assert.equal((await rows(`select name, color from staff where salon_id = '${TEST}'`)).length, 2);
      assert.equal(await outcome("select email from staff"), DENIED);
      assert.equal(await outcome("select phone from staff"), DENIED);
      assert.equal(await outcome("select user_id from staff"), DENIED);
      assert.equal(await outcome("select * from staff"), DENIED);
      assert.equal(await outcome("select reason from time_off"), DENIED);
      assert.equal(await outcome("select starts_at, ends_at from time_off"), "ok");
    });
  });

  test("sees the booking data of open salons", async () => {
    await as("anon", null, async () => {
      assert.equal(await count(`select count(*) from salons where id = '${TEST}'`), 1);
      assert.equal(await count(`select count(*) from services where salon_id = '${TEST}'`), 5);
      assert.equal(await count(`select count(*) from staff_hours where salon_id = '${TEST}'`), 10);
      assert.equal(await count(`select count(*) from staff_services where salon_id = '${TEST}'`), 9);
    });
  });

  test("sees nothing of a suspended salon", async () => {
    await as("anon", null, async () => {
      for (const table of ["services", "staff_services", "staff_hours", "time_off"]) {
        assert.equal(await count(`select count(*) from ${table} where salon_id = '${SUSPENDED}'`), 0, table);
      }
      assert.equal(await count(`select count(*) from staff where salon_id = '${SUSPENDED}'`), 0);
      assert.equal(await count(`select count(*) from salons where id = '${SUSPENDED}'`), 0);
    });
  });
});

describe("salon admin (authenticated)", () => {
  test("reads only their own salon: another salon gives an empty list, not an error", async () => {
    await as("authenticated", OWNER_TEST, async () => {
      assert.equal(await count("select count(*) from customers"), fixtures.customers.length);
      assert.equal(await count(`select count(*) from customers where salon_id = '${OTHER}'`), 0);
      assert.equal(await count(`select count(*) from bookings where salon_id = '${OTHER}'`), 0);
      assert.equal(await count(`select count(*) from staff where salon_id = '${OTHER}'`), 0);
      assert.equal(await count(`select count(*) from time_off where salon_id = '${OTHER}'`), 0);
      assert.deepEqual(await rows("select id from salons"), [{ id: TEST }]);
    });
  });

  test("cannot write into another salon", async () => {
    await as("authenticated", OWNER_TEST, async () => {
      assert.equal(
        await outcome(`insert into customers (salon_id, first_name, phone) values ('${OTHER}', 'X', '+38640999999')`),
        DENIED,
      );
      assert.equal(await affected(`update bookings set status = 'cancelled' where id = '${OTHER_BOOKING}'`), 0);
      assert.equal(await affected(`delete from customers where id = '${OTHER_CUSTOMER}'`), 0);
      assert.equal(await affected(`update salons set name = 'Prevzet' where id = '${OTHER}'`), 0);
    });
  });

  test("cannot move their own row into another salon", async () => {
    await as("authenticated", OWNER_TEST, async () => {
      assert.equal(await outcome(`update customers set salon_id = '${OTHER}' where id = '${ANA}'`), DENIED);
    });
  });

  test("can change salon settings, but not subscription, trial, slug or domain", async () => {
    await as("authenticated", OWNER_TEST, async () => {
      assert.equal(await affected(`update salons set name = 'Novo ime', slot_interval_min = 30 where id = '${TEST}'`), 1);
      assert.equal(await outcome(`update salons set subscription_status = 'active' where id = '${TEST}'`), DENIED);
      assert.equal(await outcome(`update salons set trial_ends_at = '2099-01-01' where id = '${TEST}'`), DENIED);
      assert.equal(await outcome(`update salons set slug = 'drug-slug' where id = '${TEST}'`), DENIED);
      assert.equal(await outcome(`update salons set custom_domain = 'x.si' where id = '${TEST}'`), DENIED);
      assert.equal(await outcome(`insert into salons (slug, name) values ('nov', 'Nov')`), DENIED);
      assert.equal(await outcome(`delete from salons where id = '${TEST}'`), DENIED);
    });
  });

  test("cannot add themselves to another salon or read audit_log / rate_limits", async () => {
    await as("authenticated", OWNER_TEST, async () => {
      assert.equal(
        await outcome(`insert into salon_users (salon_id, user_id) values ('${OTHER}', '${OWNER_TEST}')`),
        DENIED,
      );
      assert.equal(await outcome("select 1 from audit_log"), DENIED);
      assert.equal(await outcome("select 1 from rate_limits"), DENIED);
    });
  });

  test("cannot book with a staff member, service or customer of another salon", async () => {
    await as("authenticated", OWNER_TEST, async () => {
      // 16:00: the other salon's staff member is free then, so only the salon rule can stop it.
      assert.equal(await outcome(insertBooking({ staff: OTHER_STAFF, start: "16:00" })), FOREIGN_KEY);
      assert.equal(await outcome(insertBooking({ service: OTHER_SERVICE, start: "11:00" })), FOREIGN_KEY);
      assert.equal(await outcome(insertBooking({ customer: OTHER_CUSTOMER, start: "12:00" })), FOREIGN_KEY);
      assert.equal(await outcome(insertBooking({ start: "13:00" })), "ok");
    });
  });
});

describe("functions", () => {
  test("no SECURITY DEFINER function in public can be called by anon or logged-in users", async () => {
    // Same check as Supabase's Security Advisor: such a function would be
    // callable through the API as /rest/v1/rpc/<name>.
    const exposed = await rows(`
      select p.proname as name, r.role
        from pg_proc p, unnest(array['anon', 'authenticated']) as r(role)
       where p.pronamespace = 'public'::regnamespace
         and p.prosecdef
         and has_function_privilege(r.role, p.oid, 'execute')`);
    assert.deepEqual(exposed, []);
  });

  test("user_salon_ids() lives in the private schema, usable only by logged-in users", async () => {
    const [row] = await rows(`
      select to_regprocedure('public.user_salon_ids()') is null as gone_from_public,
             has_function_privilege('authenticated', 'private.user_salon_ids()', 'execute') as authenticated,
             has_function_privilege('anon', 'private.user_salon_ids()', 'execute') as anon,
             has_schema_privilege('anon', 'private', 'usage') as anon_schema`);
    assert.deepEqual(row, { gone_from_public: true, authenticated: true, anon: false, anon_schema: false });
  });

  test("every table has RLS on", async () => {
    assert.equal(
      await count(`select count(*) from pg_tables where schemaname = 'public' and not rowsecurity`),
      0,
    );
  });
});

describe("server (service_role, secret key)", () => {
  test("can read and write every table; RLS does not apply", async () => {
    await as("service_role", null, async () => {
      for (const table of [
        "salons", "salon_users", "staff", "services", "staff_services", "staff_hours", "time_off",
        "customers", "bookings", "booking_notifications", "payments", "audit_log", "rate_limits",
      ]) {
        assert.equal(await outcome(`select 1 from ${table} limit 1`), "ok", table);
      }
      assert.equal(await count(`select count(*) from customers where salon_id = '${OTHER}'`), 1);
      assert.equal(
        await outcome(`insert into customers (salon_id, first_name, phone) values ('${TEST}', 'Nova', '+38640999002')`),
        "ok",
      );
      assert.equal(await outcome(insertBooking({ start: "08:00", minutes: 30, buffer: 0 })), "ok");
      assert.equal(await outcome(`update bookings set status = 'no_show' where id = '${OTHER_BOOKING}'`), "ok");
      assert.equal(await outcome(`insert into rate_limits (bucket, window_start) values ('ip:1.2.3.4', now())`), "ok");
      assert.equal(
        await outcome(`insert into audit_log (salon_id, action, entity) values ('${TEST}', 'test', 'booking')`),
        "ok",
      );
    });
  });
});

describe("user with an account but no salon", () => {
  test("sees no data at all", async () => {
    await as("authenticated", STRANGER, async () => {
      for (const table of ["salons", "staff", "services", "customers", "bookings", "time_off", "payments"]) {
        assert.equal(await count(`select count(*) from ${table}`), 0, table);
      }
    });
  });
});

describe("rules the database enforces for everyone (even the server)", () => {
  test("no double booking: overlap is rejected with 23P01, the cleaning buffer included", async () => {
    await as("postgres", null, async () => {
      assert.equal(await outcome(insertBooking({ start: "10:00" })), "ok"); // 10:00-10:45, +5 min buffer
      assert.equal(await outcome(insertBooking({ start: "10:00" })), OVERLAP); // the same slot twice
      assert.equal(await outcome(insertBooking({ start: "10:48" })), OVERLAP); // inside the buffer
      assert.equal(await outcome(insertBooking({ start: "09:30" })), OVERLAP); // ends inside
      assert.equal(await outcome(insertBooking({ start: "10:00", status: "pending" })), OVERLAP);
      assert.equal(await outcome(insertBooking({ start: "10:50" })), "ok"); // right after the buffer
      assert.equal(await outcome(insertBooking({ start: "10:00", status: "cancelled" })), "ok");
      assert.equal(await outcome(insertBooking({ start: "10:00", staff: LUKA })), "ok"); // other staff member
    });
  });

  test("a cancelled booking frees its time", async () => {
    await as("postgres", null, async () => {
      await db.query(insertBooking({ start: "14:00" }));
      await db.query(`update bookings set status = 'cancelled' where starts_at = '2030-01-07 14:00+01'`);
      assert.equal(await outcome(insertBooking({ start: "14:00" })), "ok");
    });
  });

  test("records of different salons cannot be mixed", async () => {
    await as("postgres", null, async () => {
      assert.equal(await outcome(insertBooking({ staff: OTHER_STAFF, start: "15:00" })), FOREIGN_KEY);
      assert.equal(
        await outcome(`insert into staff_services values ('${OTHER_STAFF}', '${WOMENS_CUT}', '${TEST}')`),
        FOREIGN_KEY,
      );
      assert.equal(
        await outcome(
          `insert into booking_notifications (salon_id, booking_id, kind) values ('${TEST}', '${OTHER_BOOKING}', 'reminder')`,
        ),
        FOREIGN_KEY,
      );
    });
  });

  test("customer phones must be E.164 and unique per salon", async () => {
    await as("postgres", null, async () => {
      const add = (salon: string, phone: string) =>
        outcome(`insert into customers (salon_id, first_name, phone) values ('${salon}', 'Test', '${phone}')`);
      assert.equal(await add(TEST, "040 123 456"), CHECK);
      assert.equal(await add(TEST, "+38640999001"), "ok");
      assert.equal(await add(TEST, "+38640999001"), UNIQUE);
      assert.equal(await add(OTHER, "+38640999001"), "ok"); // another salon may have the same person
    });
  });

  test("salon values stay usable: interval, color, slug, amounts", async () => {
    await as("postgres", null, async () => {
      assert.equal(await outcome(`update salons set slot_interval_min = 0 where id = '${TEST}'`), CHECK);
      assert.equal(await outcome(`update salons set brand_color = 'red;}body{' where id = '${TEST}'`), CHECK);
      assert.equal(await outcome(`update salons set slug = 'Moj Salon' where id = '${TEST}'`), CHECK);
      assert.equal(await outcome(`update services set price_cents = -100 where id = '${WOMENS_CUT}'`), CHECK);
      assert.equal(await outcome(`update staff set color = 'url(x)' where id = '${MAJA}'`), CHECK);
    });
  });

  test("updated_at follows every change of a booking", async () => {
    await as("postgres", null, async () => {
      const id = fixtures.bookings[0].id;
      await db.query(`update bookings set internal_note = 'test' where id = $1`, [id]);
      const [row] = await rows(`select updated_at = now() as fresh from bookings where id = $1`, [id]);
      assert.equal(row.fresh, true);
    });
  });

  test("deleting a salon removes all of its data and nothing else", async () => {
    await as("postgres", null, async () => {
      const othersBefore = await count(`select count(*) from bookings where salon_id <> '${TEST}'`);
      assert.equal(await outcome(`delete from salons where id = '${TEST}'`), "ok");
      for (const table of ["staff", "services", "customers", "bookings", "staff_hours", "time_off"]) {
        assert.equal(await count(`select count(*) from ${table} where salon_id = '${TEST}'`), 0, table);
      }
      assert.equal(await count(`select count(*) from bookings where salon_id <> '${TEST}'`), othersBefore);
    });
  });
});
