import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  ListPropertiesResponse,
  CreatePropertyBody,
  CreatePropertyResponse,
  UpdatePropertyParams,
  UpdatePropertyBody,
  UpdatePropertyResponse,
  DeletePropertyParams,
  ListFlatsQueryParams,
  ListFlatsResponse,
  CreateFlatBody,
  CreateFlatResponse,
  UpdateFlatParams,
  UpdateFlatBody,
  UpdateFlatResponse,
  DeleteFlatParams,
  RenewFlatParams,
  RenewFlatBody,
  RenewFlatResponse,
  VacateFlatParams,
  VacateFlatResponse,
  ListFlatPaymentsParams,
  ListFlatPaymentsResponse,
  CreatePaymentParams,
  CreatePaymentBody,
  CreatePaymentResponse,
  GetDashboardSummaryResponse,
  ListActivityResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const asNumber = (value: string | number | null) => Number(value ?? 0);
// `pg` parses a SQL DATE column into a JS Date representing LOCAL midnight
// for that calendar day. Converting that through .toISOString() (UTC) shifts
// it back a day in any timezone ahead of UTC (e.g. IST), so a move-in/
// payment date of 2026-09-07 was coming back as 2026-09-06. Read the
// calendar components straight off the Date object instead - that stays
// consistent with how it was constructed, regardless of server timezone.
const isoDate = (value: Date | string) => {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const isoDateOrNull = (value: Date | string | null) => (value == null ? null : isoDate(value));
const numberOrNull = (value: string | number | null) => (value == null ? null : Number(value));
const isoTimestamp = (value: Date | string) => new Date(value).toISOString();

// "YYYY-MM" - read with the same local-getter convention as isoDate above
// (correct in production, which runs in UTC; see that comment).
const monthKey = (value: Date | string): string => {
  if (typeof value === "string") return value.slice(0, 7);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};
const monthKeyToIsoDate = (key: string) => `${key}-01`;
const addMonthKey = (key: string, delta: number): string => {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
};

type CyclePaymentRow = { id: string; flat_id: string; payment_date: Date; amount: string | number; cycle_month: Date | null; created_at: Date };
type CycleResult = {
  cycles: { cycleMonth: string; status: "paid" | "due" | "part-paid"; rentDue: number; totalPaid: number; payments: { id: string; createdAt: string; flatId: string; paymentDate: string; amount: number; cycleMonth: string | null }[] }[];
  oldestDueCycle: string | null;
  dueCycleCount: number;
};

// Rent is paid in arrears on a calendar-month cycle (1st to last day), and a
// tenant's first cycle is the calendar month containing their move-in date -
// not prorated, even if they moved in partway through it. A cycle only
// becomes due once the month has fully ended (from the 1st of the next
// month), so "the last completed month" is always the month before the
// current one, regardless of what day of the current month it is.
// One query for however many flats are being built at once (the full list,
// or just one after a mutation), rather than a query per flat.
async function buildFlatCycles(flatsForCycles: { id: string; moveInDate: Date | string | null; rent: string | number | null }[]): Promise<Map<string, CycleResult>> {
  const result = new Map<string, CycleResult>();
  const ids = flatsForCycles.map((f) => f.id);
  if (!ids.length) return result;

  const todayRow = await pool.query("SELECT CURRENT_DATE AS today");
  const currentMonthKey = monthKey(todayRow.rows[0].today);
  const lastCompletedMonthKey = addMonthKey(currentMonthKey, -1);

  const paymentsResult = await pool.query<CyclePaymentRow>(
    `SELECT id, flat_id, payment_date, amount, cycle_month, created_at FROM payments WHERE flat_id = ANY($1) ORDER BY payment_date ASC`,
    [ids],
  );
  const paymentsByFlat = new Map<string, CyclePaymentRow[]>();
  for (const row of paymentsResult.rows) {
    if (!paymentsByFlat.has(row.flat_id)) paymentsByFlat.set(row.flat_id, []);
    paymentsByFlat.get(row.flat_id)!.push(row);
  }

  for (const flat of flatsForCycles) {
    if (!flat.moveInDate) {
      result.set(flat.id, { cycles: [], oldestDueCycle: null, dueCycleCount: 0 });
      continue;
    }
    const moveInMonthKey = monthKey(flat.moveInDate);
    const rentDue = Number(flat.rent ?? 0);
    const flatPayments = paymentsByFlat.get(flat.id) ?? [];
    const paidByCycle = new Map<string, CyclePaymentRow[]>();
    for (const payment of flatPayments) {
      if (!payment.cycle_month) continue;
      const key = monthKey(payment.cycle_month);
      if (!paidByCycle.has(key)) paidByCycle.set(key, []);
      paidByCycle.get(key)!.push(payment);
    }

    const cycles: CycleResult["cycles"] = [];
    let oldestDueCycle: string | null = null;
    let dueCycleCount = 0;
    for (let cursor = moveInMonthKey; cursor <= lastCompletedMonthKey; cursor = addMonthKey(cursor, 1)) {
      const cyclePayments = paidByCycle.get(cursor) ?? [];
      const totalPaidInCycle = cyclePayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const status: "paid" | "due" | "part-paid" = totalPaidInCycle <= 0 ? "due" : totalPaidInCycle < rentDue ? "part-paid" : "paid";
      if (status !== "paid") {
        dueCycleCount += 1;
        if (!oldestDueCycle) oldestDueCycle = monthKeyToIsoDate(cursor);
      }
      cycles.push({
        cycleMonth: monthKeyToIsoDate(cursor),
        status,
        rentDue,
        totalPaid: totalPaidInCycle,
        payments: cyclePayments.map((payment) => ({
          id: payment.id, createdAt: isoTimestamp(payment.created_at), flatId: payment.flat_id,
          paymentDate: isoDate(payment.payment_date), amount: asNumber(payment.amount),
          cycleMonth: payment.cycle_month ? isoDate(payment.cycle_month) : null,
        })),
      });
    }
    result.set(flat.id, { cycles, oldestDueCycle, dueCycleCount });
  }
  return result;
}

router.get("/properties", async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT p.*, COUNT(f.id)::int AS unit_count
      FROM properties p LEFT JOIN flats f ON f.property_id = p.id AND f.deleted_at IS NULL
      WHERE p.deleted_at IS NULL
      GROUP BY p.id ORDER BY p.created_at DESC`);
    res.json(ListPropertiesResponse.parse(result.rows.map((row) => ({
      id: row.id, createdAt: isoTimestamp(row.created_at), name: row.name,
      address: row.address, unitCount: row.unit_count,
    }))));
  } catch (error) { return next(error); }
});

router.post("/properties", async (req, res, next) => {
  try {
    const input = CreatePropertyBody.parse(req.body);
    // Units are created empty (no tenant) alongside the property, so the
    // whole portfolio of a building can be entered in one step - tenants
    // get mapped onto these units later via a separate assignment.
    const unitNumbers = [...new Set((input.unitNumbers ?? []).map((flatNo) => flatNo.trim()).filter(Boolean))];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "INSERT INTO properties (name, address) VALUES ($1, $2) RETURNING *",
        [input.name, input.address],
      );
      const row = result.rows[0];
      for (const flatNo of unitNumbers) {
        await client.query("INSERT INTO flats (property_id, flat_no) VALUES ($1, $2)", [row.id, flatNo]);
      }
      await client.query("COMMIT");
      res.status(201).json(CreatePropertyResponse.parse({
        id: row.id, createdAt: isoTimestamp(row.created_at), name: row.name, address: row.address, unitCount: unitNumbers.length,
      }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) { return next(error); }
});

router.patch("/properties/:id", async (req, res, next) => {
  try {
    const { id } = UpdatePropertyParams.parse(req.params);
    const input = UpdatePropertyBody.parse(req.body);
    const result = await pool.query(
      "UPDATE properties SET name = COALESCE($1, name), address = COALESCE($2, address) WHERE id = $3 AND deleted_at IS NULL RETURNING *",
      [input.name ?? null, input.address ?? null, id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Property not found" });
    const row = result.rows[0];
    return res.json(UpdatePropertyResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), name: row.name, address: row.address, unitCount: 0,
    }));
  } catch (error) { return next(error); }
});

router.delete("/properties/:id", async (req, res, next) => {
  try {
    const { id } = DeletePropertyParams.parse(req.params);
    // Soft delete: the property (and its units, below) drop out of the active
    // workspace, but the rows - and every payment that references them -
    // stay in place so past records are never lost.
    const result = await pool.query(
      "UPDATE properties SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (result.rowCount) {
      await pool.query(
        "UPDATE flats SET deleted_at = now() WHERE property_id = $1 AND deleted_at IS NULL",
        [id],
      );
    }
    res.status(204).send();
  } catch (error) { return next(error); }
});

router.get("/flats", async (req, res, next) => {
  try {
    const { propertyId } = ListFlatsQueryParams.parse(req.query);
    const result = await pool.query(`
      SELECT f.*, (f.tenure_end IS NOT NULL AND f.tenure_end < CURRENT_DATE) AS is_expired,
        (f.tenant_name IS NOT NULL) AS is_occupied, p.name AS property_name,
        COALESCE(SUM(pay.amount), 0) AS total_paid, MAX(pay.payment_date) AS last_payment_date
      FROM flats f JOIN properties p ON p.id = f.property_id
      LEFT JOIN payments pay ON pay.flat_id = f.id
      WHERE f.deleted_at IS NULL AND p.deleted_at IS NULL
      ${propertyId ? "AND f.property_id = $1" : ""}
      GROUP BY f.id, p.name ORDER BY f.flat_no ASC
    `, propertyId ? [propertyId] : []);
    const cyclesByFlat = await buildFlatCycles(result.rows.map((row) => ({ id: row.id, moveInDate: row.move_in_date, rent: row.rent })));
    res.json(ListFlatsResponse.parse(result.rows.map((row) => {
      const cycleData = cyclesByFlat.get(row.id) ?? { cycles: [], oldestDueCycle: null, dueCycleCount: 0 };
      return {
        id: row.id, createdAt: isoTimestamp(row.created_at), propertyId: row.property_id, propertyName: row.property_name,
        flatNo: row.flat_no, tenantName: row.tenant_name, workplace: row.workplace, govtId: row.govt_id, phone: row.phone,
        moveInDate: isoDateOrNull(row.move_in_date), tenureEnd: isoDateOrNull(row.tenure_end), isExpired: row.is_expired, isOccupied: row.is_occupied,
        deposit: numberOrNull(row.deposit), rent: numberOrNull(row.rent),
        totalPaid: asNumber(row.total_paid), lastPaymentDate: row.last_payment_date ? isoDate(row.last_payment_date) : null,
        ...cycleData,
      };
    })));
  } catch (error) { return next(error); }
});

router.post("/flats", async (req, res, next) => {
  try {
    const input = CreateFlatBody.parse(req.body);
    const result = await pool.query(
      `INSERT INTO flats (property_id, flat_no, tenant_name, workplace, govt_id, phone, move_in_date, tenure_end, deposit, rent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *, (tenure_end IS NOT NULL AND tenure_end < CURRENT_DATE) AS is_expired, (tenant_name IS NOT NULL) AS is_occupied`,
      [input.propertyId, input.flatNo, input.tenantName ?? null, input.workplace ?? null, input.govtId ?? null, input.phone ?? null, input.moveInDate ?? null, input.tenureEnd ?? null, input.deposit ?? null, input.rent ?? null],
    );
    const row = result.rows[0];
    const property = await pool.query("SELECT name FROM properties WHERE id = $1", [row.property_id]);
    const cycleData = (await buildFlatCycles([{ id: row.id, moveInDate: row.move_in_date, rent: row.rent }])).get(row.id)!;
    res.status(201).json(CreateFlatResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), propertyId: row.property_id, propertyName: property.rows[0]?.name ?? "",
      flatNo: row.flat_no, tenantName: row.tenant_name, workplace: row.workplace, govtId: row.govt_id, phone: row.phone,
      moveInDate: isoDateOrNull(row.move_in_date), tenureEnd: isoDateOrNull(row.tenure_end), isExpired: row.is_expired, isOccupied: row.is_occupied,
      deposit: numberOrNull(row.deposit), rent: numberOrNull(row.rent), totalPaid: 0, lastPaymentDate: null,
      ...cycleData,
    }));
  } catch (error) { next(error); }
});

router.patch("/flats/:id", async (req, res, next) => {
  try {
    const { id } = UpdateFlatParams.parse(req.params);
    const input = UpdateFlatBody.parse(req.body);
    const result = await pool.query(
      `UPDATE flats SET flat_no=COALESCE($1,flat_no), tenant_name=COALESCE($2,tenant_name), workplace=COALESCE($3,workplace),
       govt_id=COALESCE($4,govt_id), phone=COALESCE($5,phone), move_in_date=COALESCE($6,move_in_date), tenure_end=COALESCE($7,tenure_end),
       deposit=COALESCE($8,deposit), rent=COALESCE($9,rent)
       WHERE id=$10 AND deleted_at IS NULL
       RETURNING *, (tenure_end IS NOT NULL AND tenure_end < CURRENT_DATE) AS is_expired, (tenant_name IS NOT NULL) AS is_occupied`,
      [input.flatNo ?? null, input.tenantName ?? null, input.workplace ?? null, input.govtId ?? null, input.phone ?? null, input.moveInDate ?? null, input.tenureEnd ?? null, input.deposit ?? null, input.rent ?? null, id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Flat not found" });
    const row = result.rows[0];
    const property = await pool.query("SELECT name FROM properties WHERE id = $1", [row.property_id]);
    const totals = await pool.query(
      "SELECT COALESCE(SUM(amount),0) AS total_paid, MAX(payment_date) AS last_payment_date FROM payments WHERE flat_id = $1",
      [id],
    );
    const cycleData = (await buildFlatCycles([{ id: row.id, moveInDate: row.move_in_date, rent: row.rent }])).get(row.id)!;
    return res.json(UpdateFlatResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), propertyId: row.property_id, propertyName: property.rows[0]?.name ?? "",
      flatNo: row.flat_no, tenantName: row.tenant_name, workplace: row.workplace, govtId: row.govt_id, phone: row.phone,
      moveInDate: isoDateOrNull(row.move_in_date), tenureEnd: isoDateOrNull(row.tenure_end), isExpired: row.is_expired, isOccupied: row.is_occupied,
      deposit: numberOrNull(row.deposit), rent: numberOrNull(row.rent),
      totalPaid: asNumber(totals.rows[0].total_paid),
      lastPaymentDate: totals.rows[0].last_payment_date ? isoDate(totals.rows[0].last_payment_date) : null,
      ...cycleData,
    }));
  } catch (error) { return next(error); }
});

router.delete("/flats/:id", async (req, res, next) => {
  try {
    const { id } = DeleteFlatParams.parse(req.params);
    // Soft delete: the unit/tenant drops out of the active ledger, but its
    // row - and every payment recorded against it - stays in place.
    await pool.query("UPDATE flats SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL", [id]);
    res.status(204).send();
  } catch (error) { next(error); }
});

router.post("/flats/:id/renew", async (req, res, next) => {
  try {
    const { id } = RenewFlatParams.parse(req.params);
    const input = RenewFlatBody.parse(req.body);
    // Renewing only extends the tenure and (optionally) updates rent -
    // moveInDate is untouched since the tenant didn't move in again. Only
    // applies to an occupied unit; a vacant one has no lease to renew.
    const result = await pool.query(
      `UPDATE flats SET tenure_end=$1, rent=$2 WHERE id=$3 AND deleted_at IS NULL AND tenant_name IS NOT NULL
       RETURNING *, (tenure_end IS NOT NULL AND tenure_end < CURRENT_DATE) AS is_expired, (tenant_name IS NOT NULL) AS is_occupied`,
      [input.tenureEnd, input.rent, id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Flat not found" });
    const row = result.rows[0];
    const property = await pool.query("SELECT name FROM properties WHERE id = $1", [row.property_id]);
    const totals = await pool.query(
      "SELECT COALESCE(SUM(amount),0) AS total_paid, MAX(payment_date) AS last_payment_date FROM payments WHERE flat_id = $1",
      [id],
    );
    const cycleData = (await buildFlatCycles([{ id: row.id, moveInDate: row.move_in_date, rent: row.rent }])).get(row.id)!;
    return res.json(RenewFlatResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), propertyId: row.property_id, propertyName: property.rows[0]?.name ?? "",
      flatNo: row.flat_no, tenantName: row.tenant_name, workplace: row.workplace, govtId: row.govt_id, phone: row.phone,
      moveInDate: isoDateOrNull(row.move_in_date), tenureEnd: isoDateOrNull(row.tenure_end), isExpired: row.is_expired, isOccupied: row.is_occupied,
      deposit: numberOrNull(row.deposit), rent: numberOrNull(row.rent),
      totalPaid: asNumber(totals.rows[0].total_paid),
      lastPaymentDate: totals.rows[0].last_payment_date ? isoDate(totals.rows[0].last_payment_date) : null,
      ...cycleData,
    }));
  } catch (error) { return next(error); }
});

router.post("/flats/:id/vacate", async (req, res, next) => {
  try {
    const { id } = VacateFlatParams.parse(req.params);
    // Clears the tenant assignment but keeps the unit row itself, so the
    // unit stays in the portfolio and can be assigned to a new tenant later.
    const result = await pool.query(
      `UPDATE flats SET tenant_name=NULL, workplace=NULL, govt_id=NULL, phone=NULL, move_in_date=NULL, tenure_end=NULL, deposit=NULL, rent=NULL
       WHERE id=$1 AND deleted_at IS NULL
       RETURNING *, false AS is_expired, false AS is_occupied`,
      [id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Flat not found" });
    const row = result.rows[0];
    const property = await pool.query("SELECT name FROM properties WHERE id = $1", [row.property_id]);
    const totals = await pool.query(
      "SELECT COALESCE(SUM(amount),0) AS total_paid, MAX(payment_date) AS last_payment_date FROM payments WHERE flat_id = $1",
      [id],
    );
    const cycleData = (await buildFlatCycles([{ id: row.id, moveInDate: null, rent: null }])).get(row.id)!;
    return res.json(VacateFlatResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), propertyId: row.property_id, propertyName: property.rows[0]?.name ?? "",
      flatNo: row.flat_no, tenantName: null, workplace: null, govtId: null, phone: null,
      moveInDate: null, tenureEnd: null, isExpired: false, isOccupied: false,
      deposit: null, rent: null,
      totalPaid: asNumber(totals.rows[0].total_paid),
      lastPaymentDate: totals.rows[0].last_payment_date ? isoDate(totals.rows[0].last_payment_date) : null,
      ...cycleData,
    }));
  } catch (error) { return next(error); }
});

router.get("/flats/:id/payments", async (req, res, next) => {
  try {
    const { id } = ListFlatPaymentsParams.parse(req.params);
    const result = await pool.query("SELECT * FROM payments WHERE flat_id=$1 ORDER BY payment_date DESC", [id]);
    res.json(ListFlatPaymentsResponse.parse(result.rows.map((row) => ({
      id: row.id, createdAt: isoTimestamp(row.created_at), flatId: row.flat_id, paymentDate: isoDate(row.payment_date), amount: asNumber(row.amount),
      cycleMonth: row.cycle_month ? isoDate(row.cycle_month) : null,
    }))));
  } catch (error) { next(error); }
});

router.post("/flats/:id/payments", async (req, res, next) => {
  try {
    const { id } = CreatePaymentParams.parse(req.params);
    const input = CreatePaymentBody.parse(req.body);
    const flat = await pool.query("SELECT id FROM flats WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!flat.rowCount) return res.status(404).json({ error: "Flat not found" });
    const result = await pool.query(
      "INSERT INTO payments (flat_id, payment_date, amount, cycle_month) VALUES ($1,$2,$3,$4) RETURNING *",
      [id, input.paymentDate, input.amount, input.cycleMonth],
    );
    const row = result.rows[0];
    return res.status(201).json(CreatePaymentResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), flatId: row.flat_id, paymentDate: isoDate(row.payment_date), amount: asNumber(row.amount),
      cycleMonth: row.cycle_month ? isoDate(row.cycle_month) : null,
    }));
  } catch (error) { return next(error); }
});

router.get("/dashboard/summary", async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT
      COALESCE(SUM(rent),0) AS expected, COUNT(*) FILTER (WHERE tenant_name IS NOT NULL)::int AS occupied,
      COUNT(*)::int AS total_units, (SELECT COUNT(*)::int FROM properties WHERE deleted_at IS NULL) AS properties_count,
      COALESCE((SELECT SUM(amount) FROM payments WHERE date_trunc('month', payment_date) = date_trunc('month', CURRENT_DATE)),0) AS collected,
      COUNT(*) FILTER (WHERE move_in_date IS NOT NULL AND move_in_date <= CURRENT_DATE - INTERVAL '11 months')::int AS due
      FROM flats WHERE deleted_at IS NULL`);
    const row = result.rows[0];
    res.json(GetDashboardSummaryResponse.parse({
      expectedMonthlyRevenue: asNumber(row.expected), totalCollected: asNumber(row.collected), occupiedUnits: row.occupied,
      totalUnits: row.total_units, propertiesCount: row.properties_count, dueForRevision: row.due,
    }));
  } catch (error) { next(error); }
});

router.get("/activity", async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT id::text, 'payment' AS type, 'Payment recorded' AS title,
      'A new rent payment was added to the ledger' AS description, created_at FROM payments
      ORDER BY created_at DESC LIMIT 8`);
    res.json(ListActivityResponse.parse(result.rows.map((row) => ({
      id: row.id, type: row.type, title: row.title, description: row.description, createdAt: isoTimestamp(row.created_at),
    }))));
  } catch (error) { next(error); }
});

export default router;
