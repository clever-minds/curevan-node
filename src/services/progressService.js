// How much a patient has improved over a treatment plan (handoff pack P16).
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const num = (v) => (v === null || v === undefined ? null : Number(v));
const r2 = (n) => (n === null ? null : Math.round(n * 100) / 100);

/** Positive = better, whichever direction the scale goes. */
const gain = (measure, from, to) => (measure.higher_is_better ? to - from : from - to);

/** Last-3-values trend: improving / no change / worsening. */
function trend(measure, values) {
  const last = values.slice(-3);
  if (last.length < 2) return "no change";
  const g = gain(measure, last[0], last[last.length - 1]);
  return g > 0 ? "improving" : g < 0 ? "worsening" : "no change";
}

/** Stalled = two consecutive checkpoints (baseline/review/discharge) without improvement on the primary goal measure. */
function isStalled(measure, checkpointValues) {
  if (checkpointValues.length < 3) return false;
  const [a, b, c] = checkpointValues.slice(-3);
  return gain(measure, a, b) <= 0 && gain(measure, b, c) <= 0;
}

async function sessionsDone(planId) {
  const [row] = await sequelize.query(
    `SELECT COUNT(*)::int AS n FROM appointments WHERE treatment_plan_id = :planId AND status = 'completed'`,
    { replacements: { planId }, type: QueryTypes.SELECT }
  );
  return row.n;
}

/** attended / planned-to-date, where planned-to-date follows the weekly frequency since the plan started (never above planned_sessions). */
function adherence(plan, attended, now = Date.now()) {
  const start = plan.plan_start ? new Date(plan.plan_start).getTime() : null;
  const weeks = start ? Math.max(1, Math.ceil((now - start) / (7 * 86400000))) : 1;
  const perWeek = Number(plan.frequency_per_week) || 1;
  const planned = plan.planned_sessions ? Math.min(Number(plan.planned_sessions), weeks * perWeek) : weeks * perWeek;
  return { attended, plannedToDate: planned, ratio: planned ? r2(Math.min(1, attended / planned)) : null };
}

async function planProgress(planId, now = Date.now()) {
  const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  const [plan] = await q(`SELECT * FROM treatment_plans WHERE id = :planId`, { planId });
  if (!plan) return null;

  const goals = await q(
    `SELECT g.*, m.code AS measure_code, m.name AS measure_name FROM treatment_goals g LEFT JOIN outcome_measures m ON m.id = g.measure_id WHERE g.plan_id = :planId ORDER BY g.id`,
    { planId }
  );
  const planMeasures = await q(
    `SELECT pm.id AS plan_measure_id, pm.side AS plan_side, pm.item AS plan_item, m.* FROM plan_measures pm JOIN outcome_measures m ON m.id = pm.measure_id WHERE pm.plan_id = :planId ORDER BY pm.id`,
    { planId }
  );
  const results = await q(
    `SELECT r.*, p.session_number FROM outcome_results r LEFT JOIN pcr p ON p.id = r.pcr_id WHERE r.plan_id = :planId AND r.value IS NOT NULL ORDER BY r.recorded_at, r.id`,
    { planId }
  );

  const measures = planMeasures.map((pm) => {
    const rows = results.filter((r) => r.measure_id === pm.id && (pm.plan_side ? r.side === pm.plan_side : true) && (pm.plan_item ? r.item === pm.plan_item : true));
    const series = rows.map((r) => ({ date: r.recorded_at, sessionNumber: r.session_number, value: num(r.value), side: r.side, item: r.item, point: r.assessment_point }));
    const values = series.map((s) => s.value);
    const baseline = (series.find((s) => s.point === "baseline") || series[0] || {}).value ?? null;
    const latest = values.length ? values[values.length - 1] : null;
    const goal = goals.find((g) => g.measure_id === pm.id);
    const target = goal ? num(goal.target_value) : null;
    const change = baseline !== null && latest !== null ? r2(latest - baseline) : null;
    const pct = target !== null && baseline !== null && latest !== null && target !== baseline ? r2(((latest - baseline) / (target - baseline)) * 100) : null;
    return {
      planMeasureId: pm.plan_measure_id, measureId: pm.id, code: pm.code, name: pm.name, unit: pm.unit, side: pm.plan_side, item: pm.plan_item,
      higherIsBetter: pm.higher_is_better, perSide: pm.per_side, scaleType: pm.scale_type,
      series, baseline, latest, target, absoluteChange: change, percentTowardTarget: pct,
      status: trend(pm, values),
      _checkpoints: series.filter((s) => ["baseline", "review", "discharge"].includes(s.point)).map((s) => s.value),
      _row: pm,
    };
  });

  const primaryGoal = goals.find((g) => g.measure_id);
  let stalled = false;
  if (primaryGoal) {
    const m = measures.find((x) => x.measureId === primaryGoal.measure_id);
    if (m) stalled = isStalled(m._row, m._checkpoints);
  }

  const goalProgress = goals.map((g) => {
    const m = measures.find((x) => x.measureId === g.measure_id);
    return {
      id: g.id, description: g.description, status: g.status, measureCode: g.measure_code, measureName: g.measure_name,
      baseline: m ? m.baseline : num(g.baseline_value), latest: m ? m.latest : null, target: num(g.target_value), targetDate: g.target_date,
      percentTowardTarget: m ? m.percentTowardTarget : null,
    };
  });

  const done = await sessionsDone(planId);
  return {
    plan, goals: goalProgress, stalled,
    sessionsDone: done, plannedSessions: plan.planned_sessions,
    adherence: adherence(plan, done, now),
    measures: measures.map(({ _checkpoints, _row, ...m }) => m),
  };
}

module.exports = { planProgress, trend, isStalled, gain, adherence };
