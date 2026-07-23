(function (root) {
  "use strict";

  var MONTHS = [1, 2, 3, 6, 12];

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function priorityOf(rule) {
    var value = Number(rule && rule.priority);
    return Number.isFinite(value) ? value : 100;
  }

  function matchingRules(service, durationIndex, typeIndex) {
    var offers =
        service && Array.isArray(service.bundle_offers)
          ? service.bundle_offers
          : [],
      duration = Number(durationIndex),
      selectedType = Number(typeIndex || 0),
      matches = offers.filter(function (offer) {
        var sourceType = numberOrNull(offer && offer.source_type_idx);
        return (
          Number(offer && offer.source_duration_idx) === duration &&
          (sourceType === null || sourceType === selectedType)
        );
      }),
      byGift = {};

    matches
      .sort(function (left, right) {
        var leftSpecific = numberOrNull(left.source_type_idx) === null ? 1 : 0,
          rightSpecific =
            numberOrNull(right.source_type_idx) === null ? 1 : 0;
        return (
          leftSpecific - rightSpecific ||
          priorityOf(left) - priorityOf(right) ||
          String(left.id || "").localeCompare(String(right.id || ""))
        );
      })
      .forEach(function (offer) {
        var key = String(offer.gift_service_id || offer.id || "");
        if (!byGift[key]) byGift[key] = offer;
      });

    return Object.keys(byGift)
      .map(function (key) {
        return byGift[key];
      })
      .sort(function (left, right) {
        return (
          priorityOf(left) - priorityOf(right) ||
          String(left.gift_service_id || "").localeCompare(
            String(right.gift_service_id || ""),
          )
        );
      });
  }

  function giftDurationIndex(rule, sourceDurationIndex) {
    var fixed = numberOrNull(rule && rule.gift_duration_idx);
    return rule && rule.gift_duration_strategy === "fixed" && fixed !== null
      ? fixed
      : Number(sourceDurationIndex || 0);
  }

  function monthsForIndex(index) {
    return MONTHS[Number(index)] || 1;
  }

  function effectiveStatus(rule, nowValue) {
    var now = nowValue ? new Date(nowValue).getTime() : Date.now(),
      starts = rule && rule.starts_at
        ? new Date(rule.starts_at).getTime()
        : null,
      ends = rule && rule.ends_at ? new Date(rule.ends_at).getTime() : null,
      archived = Boolean(
        rule &&
          rule.metadata &&
          (rule.metadata.archived_at || rule.metadata.archived === true),
      );
    if (archived) return "archived";
    if (!rule || rule.active !== true) return "disabled";
    if (Number.isFinite(ends) && ends <= now) return "expired";
    if (Number.isFinite(starts) && starts > now) return "scheduled";
    return "active";
  }

  function validateDraft(draft) {
    var errors = [],
      sourceDuration = Number(draft && draft.source_duration_idx),
      sourceType = numberOrNull(draft && draft.source_type_idx),
      giftDuration = numberOrNull(draft && draft.gift_duration_idx),
      quantity = Number(draft && draft.gift_quantity),
      priority = Number(draft && draft.priority),
      starts = draft && draft.starts_at
        ? new Date(draft.starts_at).getTime()
        : null,
      ends = draft && draft.ends_at
        ? new Date(draft.ends_at).getTime()
        : null;

    if (!draft || !String(draft.source_service_id || "").trim())
      errors.push("source_service_id");
    if (!draft || !String(draft.gift_service_id || "").trim())
      errors.push("gift_service_id");
    if (!Number.isInteger(sourceDuration) || sourceDuration < 0 || sourceDuration > 4)
      errors.push("source_duration_idx");
    if (
      sourceType !== null &&
      (!Number.isInteger(sourceType) || sourceType < 0 || sourceType > 19)
    )
      errors.push("source_type_idx");
    if (
      draft &&
      draft.gift_duration_strategy === "fixed" &&
      (!Number.isInteger(giftDuration) || giftDuration < 0 || giftDuration > 4)
    )
      errors.push("gift_duration_idx");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20)
      errors.push("gift_quantity");
    if (
      draft &&
      draft.quantity_mode === "per_unit" &&
      quantity !== 1
    )
      errors.push("per_unit_quantity");
    if (!Number.isInteger(priority) || priority < 1 || priority > 10000)
      errors.push("priority");
    if (draft && !["fixed", "per_unit"].includes(draft.quantity_mode))
      errors.push("quantity_mode");
    if (
      draft &&
      !["shared_reusable", "exclusive"].includes(draft.allocation_policy)
    )
      errors.push("allocation_policy");
    if (starts !== null && !Number.isFinite(starts)) errors.push("starts_at");
    if (ends !== null && !Number.isFinite(ends)) errors.push("ends_at");
    if (
      Number.isFinite(starts) &&
      Number.isFinite(ends) &&
      ends <= starts
    )
      errors.push("schedule");
    return errors;
  }

  root.StrivioBundles = {
    MONTHS: MONTHS.slice(),
    matchingRules: matchingRules,
    giftDurationIndex: giftDurationIndex,
    monthsForIndex: monthsForIndex,
    effectiveStatus: effectiveStatus,
    validateDraft: validateDraft,
  };
})(window);
