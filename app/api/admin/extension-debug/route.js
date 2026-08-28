import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  getReservationForExtension,
  getArrivalDate,
  getDepartureDate,
  isPastDate,
  getUnitGroupNightlyAvailability,
  isUnitAvailable,
} from "@/lib/apaleo";
import { getExtensionConfig } from "@/lib/store";
import { getReservationUnitGroupId } from "@/lib/unitGroupRestriction";
import { getStayExtensionOffer, determineConsecutiveFreeNights } from "@/lib/guest";
import { decideExtensionOffer, computeAverageNightlyRate } from "@/lib/stayExtension";

// TEMPORARY diagnostic endpoint. Admin-only, read-only, never mutates KV or
// Apaleo. Traces a single reservation through the exact same functions the
// guest catalog route uses to decide the "stay one more night" offer
// (lib/guest.js's getStayExtensionOffer/determineConsecutiveFreeNights,
// lib/stayExtension.js's decideExtensionOffer/computeAverageNightlyRate),
// so a production run can show precisely which condition first suppresses
// the offer instead of us having to infer it. Remove once the AELJHZUS-1
// investigation is closed out.

function addDaysUTC(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(amount) {
  return Math.round(amount * 100) / 100;
}

export async function GET(request) {
  const { error } = await requireRole(["admin", "manager"]);
  if (error) return error;

  const reservationId = request.nextUrl.searchParams.get("reservationId");
  if (!reservationId) {
    return NextResponse.json({ error: "reservationId ist erforderlich." }, { status: 400 });
  }

  const trace = {
    reservationId,
    propertyId: null,
    status: null,
    arrival: null,
    departure: null,
    config: null,
    timing: {
      now: new Date().toISOString(),
      daysUntilDeparture: null,
      isPastDeparture: null,
    },
    assignment: {
      assignedUnitId: null,
      unitGroupId: null,
      physicalCount: null,
      safeForExtension: null,
    },
    actions: {
      amendDepartureAllowed: null,
      amendTimeSlicesAllowed: null,
    },
    availabilityChecks: [],
    calculatedGap: null,
    decision: null,
    pricing: {
      accommodationTimeSliceCount: null,
      accommodationGrossTotal: null,
      averageNightlyRate: null,
      extensionPrice: null,
    },
    finalOfferObject: null,
    suppressionReason: null,
  };

  try {
    // Same call the guest path makes (lib/guest.js's getStayExtensionOffer),
    // expanded with timeSlices/actions/assignedUnits.
    const fresh = await getReservationForExtension(reservationId);
    if (!fresh) {
      trace.suppressionReason = "reservation_not_found";
      return NextResponse.json(trace);
    }

    trace.propertyId = fresh.property?.id || null;
    trace.status = fresh.status || null;
    trace.arrival = getArrivalDate(fresh);
    trace.departure = getDepartureDate(fresh);

    if (!trace.propertyId) {
      trace.suppressionReason = "missing_property_id";
      return NextResponse.json(trace);
    }

    // --- Condition 1: property config (getStayExtensionOffer's first check) --
    const config = await getExtensionConfig(trace.propertyId);
    trace.config = config;
    if (!config.extensionNightEnabled) {
      trace.suppressionReason = "extensionNightEnabled_false";
      return NextResponse.json(trace);
    }

    // --- Condition 2: Apaleo's own authoritative actions[] flags --
    const actionsArr = Array.isArray(fresh.actions) ? fresh.actions : [];
    const amendDepartureAllowed = actionsArr.find((a) => a.action === "AmendDeparture")?.isAllowed === true;
    const amendTimeSlicesAllowed = actionsArr.find((a) => a.action === "AmendTimeSlices")?.isAllowed === true;
    trace.actions = { amendDepartureAllowed, amendTimeSlicesAllowed };
    if (!amendDepartureAllowed) {
      trace.suppressionReason = "amendDeparture_not_allowed";
      return NextResponse.json(trace);
    }

    // --- Condition 3: departure not in the past --
    const isPastDeparture = isPastDate(trace.departure);
    trace.timing.isPastDeparture = isPastDeparture;
    if (trace.departure) {
      const today = new Date().toISOString().slice(0, 10);
      trace.timing.daysUntilDeparture = Math.round(
        (new Date(`${trace.departure}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000
      );
    }
    if (isPastDeparture) {
      trace.suppressionReason = "departure_in_past";
      return NextResponse.json(trace);
    }

    // --- Condition 4: a resolvable unit group --
    const unitGroupId = getReservationUnitGroupId(fresh);
    const assignedUnitId = fresh.unit?.id || null;
    trace.assignment.assignedUnitId = assignedUnitId;
    trace.assignment.unitGroupId = unitGroupId;
    if (!unitGroupId) {
      trace.suppressionReason = "missing_unit_group_id";
      return NextResponse.json(trace);
    }
    if (!trace.departure) {
      trace.suppressionReason = "missing_departure_date";
      return NextResponse.json(trace);
    }

    // --- Raw night-by-night evidence (diagnostic only) --
    // This re-queries the exact same two Apaleo endpoints
    // determineConsecutiveFreeNights uses below, purely to expose what each
    // night looked like. The actual gap used for the decision comes from
    // calling determineConsecutiveFreeNights itself further down, not from
    // this loop.
    const lookaheadNights = Math.max(Number(config.minSellableStayNights) || 0, 0) + 1;
    const rangeEnd = addDaysUTC(trace.departure, lookaheadNights);
    const nightly = rangeEnd
      ? await getUnitGroupNightlyAvailability(trace.propertyId, unitGroupId, trace.departure, rangeEnd)
      : [];
    for (const entry of nightly) {
      const group = entry?.unitGroups?.[0];
      const physicalCount = group ? Number(group.physicalCount) : null;
      const groupAvailableCount = group ? Number(group.availableCount) : null;
      if (trace.assignment.physicalCount === null && physicalCount !== null) {
        trace.assignment.physicalCount = physicalCount;
      }
      let assignedUnitAvailable = null;
      if (assignedUnitId && groupAvailableCount > 0) {
        assignedUnitAvailable = await isUnitAvailable(
          trace.propertyId,
          unitGroupId,
          assignedUnitId,
          entry?.from,
          entry?.to
        );
      }
      trace.availabilityChecks.push({
        from: entry?.from || null,
        to: entry?.to || null,
        groupAvailableCount,
        physicalCount,
        assignedUnitAvailable,
      });
    }
    trace.assignment.safeForExtension = assignedUnitId
      ? true
      : trace.assignment.physicalCount === 1;

    // --- The actual gap, via the real function the guest path calls --
    const gap = await determineConsecutiveFreeNights({
      propertyId: trace.propertyId,
      unitGroupId,
      assignedUnitId,
      departureDate: trace.departure,
      minSellableStayNights: config.minSellableStayNights,
    });
    trace.calculatedGap = gap;

    const decision = decideExtensionOffer({
      gap,
      minSellableStayNights: config.minSellableStayNights,
      discountOneNightGap: config.extensionDiscountOneNightGap,
      discountStandard: config.extensionDiscountStandard,
    });
    trace.decision = decision;

    const timeSlices = Array.isArray(fresh.timeSlices) ? fresh.timeSlices : [];
    const averageNightlyRate = computeAverageNightlyRate(timeSlices);
    trace.pricing.accommodationTimeSliceCount = timeSlices.length;
    trace.pricing.accommodationGrossTotal = timeSlices.length
      ? round2(timeSlices.reduce((sum, s) => sum + Number(s?.totalGrossAmount?.amount || 0), 0))
      : null;
    trace.pricing.averageNightlyRate = averageNightlyRate;

    if (!decision.offer) {
      trace.suppressionReason = decision.reason;
      return NextResponse.json(trace);
    }
    if (averageNightlyRate === null) {
      trace.suppressionReason = "average_nightly_rate_unavailable";
      return NextResponse.json(trace);
    }
    trace.pricing.extensionPrice = round2(averageNightlyRate * (1 - decision.discountPercent / 100));

    // --- Cross-check: call the exact function the guest catalog route
    // calls, so this trace can never silently diverge from the real
    // response the guest actually receives.
    const finalOffer = await getStayExtensionOffer(fresh);
    trace.finalOfferObject = finalOffer;
    trace.suppressionReason = finalOffer
      ? null
      : "getStayExtensionOffer_returned_null_despite_local_decision_true";

    return NextResponse.json(trace);
  } catch (err) {
    trace.suppressionReason = `exception: ${err?.message || String(err)}`;
    return NextResponse.json(trace);
  }
}
