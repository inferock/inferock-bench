const USD_CENT_DIGITS = 2;
const USD_MICRO_DIGITS = 6;
// Display partitions round the total first, then allocate leftover display
// units to components by largest fractional remainder. Stored/raw values stay
// untouched; this is only for strings where component labels must add to the
// displayed total.
export function reconcileDisplayPartition(input) {
    const finiteDisplayNumber = (value) => {
        const numeric = Number(value ?? 0);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
    };
    const fractionDigits = Number.isInteger(input.fractionDigits)
        ? Math.max(0, Math.min(9, input.fractionDigits))
        : 0;
    const scale = 10 ** fractionDigits;
    const total = finiteDisplayNumber(input.total);
    const totalUnits = Math.round(total * scale);
    const normalized = input.parts.map((part, index) => {
        const value = finiteDisplayNumber(part.value);
        const rawUnits = value * scale;
        const floorUnits = Math.floor(rawUnits);
        return {
            key: part.key,
            value,
            index,
            floorUnits,
            remainder: rawUnits - floorUnits,
        };
    });
    const units = normalized.map((part) => part.floorUnits);
    let residual = totalUnits - units.reduce((sum, value) => sum + value, 0);
    if (normalized.length > 0 && residual > 0) {
        const order = [...normalized].sort((left, right) => right.remainder - left.remainder ||
            right.value - left.value ||
            left.index - right.index);
        for (let cursor = 0; residual > 0; residual -= 1, cursor += 1) {
            units[order[cursor % order.length]?.index ?? 0] += 1;
        }
    }
    else if (normalized.length > 0 && residual < 0) {
        const order = [...normalized].sort((left, right) => left.remainder - right.remainder ||
            right.value - left.value ||
            left.index - right.index);
        for (let cursor = 0; residual < 0; cursor += 1) {
            const targetIndex = order[cursor % order.length]?.index ?? 0;
            if (units[targetIndex] <= 0 && units.some((value) => value > 0))
                continue;
            units[targetIndex] -= 1;
            residual += 1;
        }
    }
    return {
        total,
        totalUnits,
        parts: normalized.map((part) => ({
            key: part.key,
            value: units[part.index] / scale,
            units: units[part.index],
        })),
    };
}
export function reconciledUsdPartition(input) {
    const fractionDigits = input.fractionDigits ??
        usdFractionDigitsForPartition(input.total, input.parts.map((part) => part.value));
    const partition = reconcileDisplayPartition({
        total: input.total,
        parts: input.parts,
        fractionDigits,
    });
    const parts = {};
    const values = {};
    for (const part of partition.parts) {
        parts[part.key] = formatDisplayUsd(part.value, fractionDigits);
        values[part.key] = part.value;
    }
    return {
        fractionDigits,
        total: formatDisplayUsd(partition.totalUnits / (10 ** fractionDigits), fractionDigits),
        parts,
        values,
    };
}
export function reconciledApproxTimePartition(input) {
    const spec = approxTimeDisplaySpec(input.totalMs);
    const partition = reconcileDisplayPartition({
        total: finiteNonnegative(input.totalMs) / spec.unitMs,
        parts: input.parts.map((part) => ({
            key: part.key,
            value: finiteNonnegative(part.value) / spec.unitMs,
        })),
        fractionDigits: 0,
    });
    const parts = {};
    for (const part of partition.parts) {
        parts[part.key] = formatApproxTimeUnits(part.units, spec);
    }
    return {
        total: formatApproxTimeUnits(partition.totalUnits, spec),
        parts,
    };
}
function usdFractionDigitsForPartition(total, parts) {
    const values = [total, ...parts].map(finiteNonnegative);
    return values.some((value) => value > 0 && value < 0.01) ? USD_MICRO_DIGITS : USD_CENT_DIGITS;
}
function formatDisplayUsd(value, fractionDigits) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(value);
}
function approxTimeDisplaySpec(totalMs) {
    const value = finiteNonnegative(totalMs);
    if (value < 60_000)
        return { unitMs: 1_000, suffix: "s", divisor: 1, fractionDigits: 0 };
    if (value < 3_600_000)
        return { unitMs: 6_000, suffix: "min", divisor: 10, fractionDigits: 1 };
    return { unitMs: 360_000, suffix: "hr", divisor: 10, fractionDigits: 1 };
}
function formatApproxTimeUnits(units, spec) {
    if (units <= 0)
        return "~0s";
    if (spec.fractionDigits === 0)
        return `~${new Intl.NumberFormat("en-US").format(units)}${spec.suffix}`;
    return `~${(units / spec.divisor).toFixed(spec.fractionDigits)} ${spec.suffix}`;
}
function finiteNonnegative(value) {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}
//# sourceMappingURL=display-partition.js.map