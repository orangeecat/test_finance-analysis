"""Create reproducible descriptive analysis artifacts for the Big 4 audit data."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "raw" / "big4_financial_risk_compliance.csv"
OUTPUT = ROOT / "outputs" / "advanced_analysis"
REQUIRED_COLUMNS = [
    "Year", "Firm_Name", "Total_Audit_Engagements", "High_Risk_Cases",
    "Compliance_Violations", "Fraud_Cases_Detected", "Industry_Affected",
    "Total_Revenue_Impact", "AI_Used_for_Auditing", "Employee_Workload",
    "Audit_Effectiveness_Score", "Client_Satisfaction_Score",
]
COUNT_COLUMNS = ["Total_Audit_Engagements", "High_Risk_Cases", "Compliance_Violations", "Fraud_Cases_Detected"]
SCORE_COLUMNS = ["Audit_Effectiveness_Score", "Client_Satisfaction_Score"]


def validate(frame: pd.DataFrame) -> dict[str, object]:
    missing = [column for column in REQUIRED_COLUMNS if column not in frame]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    if frame[REQUIRED_COLUMNS].isna().any().any():
        raise ValueError("Required columns contain missing values")
    if frame.duplicated().any():
        raise ValueError("Input contains duplicate rows")
    if not frame["AI_Used_for_Auditing"].isin(["Yes", "No"]).all():
        raise ValueError("AI_Used_for_Auditing must contain only Yes or No")
    if (frame[COUNT_COLUMNS] < 0).any().any() or (frame["Total_Revenue_Impact"] < 0).any():
        raise ValueError("Counts and revenue impact must be nonnegative")
    if not frame[SCORE_COLUMNS].apply(lambda column: column.between(1, 10).all()).all():
        raise ValueError("Scores must be between 1 and 10")
    if (frame["High_Risk_Cases"] > frame["Total_Audit_Engagements"]).any():
        raise ValueError("High-risk cases cannot exceed audit engagements")
    return {
        "source": SOURCE.relative_to(ROOT).as_posix(),
        "rows": int(len(frame)),
        "columns": int(len(frame.columns)),
        "missing_values": {key: int(value) for key, value in frame.isna().sum().items()},
        "duplicate_rows": int(frame.duplicated().sum()),
        "validated_at_utc": datetime.now(timezone.utc).isoformat(),
        "checks": {"required_columns": True, "no_missing_values": True, "no_duplicate_rows": True,
                    "nonnegative_counts_and_impact": True, "scores_1_to_10": True,
                    "high_risk_cases_within_engagements": True, "ai_values_yes_no": True},
    }


def enrich(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    denominator = result["Total_Audit_Engagements"]
    result["high_risk_rate_pct"] = result["High_Risk_Cases"].div(denominator).mul(100)
    result["compliance_violation_rate_pct"] = result["Compliance_Violations"].div(denominator).mul(100)
    result["fraud_detection_rate_pct"] = result["Fraud_Cases_Detected"].div(denominator).mul(100)
    result["revenue_impact_per_engagement"] = result["Total_Revenue_Impact"].div(denominator)
    result["risk_case_burden_pct"] = result[["high_risk_rate_pct", "compliance_violation_rate_pct"]].sum(axis=1)
    return result


def save_grouped(data: pd.DataFrame) -> None:
    groupings = {"firm_summary.csv": ["Firm_Name"], "year_summary.csv": ["Year"],
                 "industry_summary.csv": ["Industry_Affected"], "trend_table.csv": ["Year", "Firm_Name"]}
    metrics = COUNT_COLUMNS + ["Total_Revenue_Impact", "Employee_Workload", *SCORE_COLUMNS,
                               "high_risk_rate_pct", "compliance_violation_rate_pct", "fraud_detection_rate_pct",
                               "revenue_impact_per_engagement", "risk_case_burden_pct"]
    for filename, keys in groupings.items():
        grouped = data.groupby(keys, dropna=False)[metrics].agg(["mean", "median", "min", "max"])
        grouped.columns = ["_".join(column) for column in grouped.columns]
        grouped.reset_index().to_csv(OUTPUT / filename, index=False)


def save_distribution_and_outliers(data: pd.DataFrame) -> None:
    measures = COUNT_COLUMNS + ["Total_Revenue_Impact", "Employee_Workload", *SCORE_COLUMNS,
                                "high_risk_rate_pct", "compliance_violation_rate_pct", "fraud_detection_rate_pct"]
    data[measures].describe().T.to_csv(OUTPUT / "distribution_summary.csv")
    rows = []
    for column in measures:
        values = data[column]
        q1, q3 = values.quantile([0.25, 0.75])
        iqr = q3 - q1
        lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        flagged = values[(values < lower) | (values > upper)]
        rows.append({"metric": column, "q1": q1, "q3": q3, "iqr": iqr, "lower_bound": lower,
                     "upper_bound": upper, "outlier_count": int(flagged.size),
                     "outlier_row_indices": ",".join(map(str, flagged.index.tolist()))})
    pd.DataFrame(rows).to_csv(OUTPUT / "outlier_analysis.csv", index=False)


def save_charts(data: pd.DataFrame) -> None:
    sns.set_theme(style="whitegrid", context="notebook")
    plt.figure(figsize=(10, 6))
    sns.barplot(data=data, x="Firm_Name", y="fraud_detection_rate_pct", hue="AI_Used_for_Auditing", errorbar=None)
    plt.ylabel("Fraud detection rate (%)")
    plt.title("Fraud detection rate by firm and AI use")
    plt.tight_layout()
    plt.savefig(OUTPUT / "fraud_detection_by_ai.png", dpi=160)
    plt.close()
    trend = data.groupby("Year", as_index=False)[["high_risk_rate_pct", "compliance_violation_rate_pct", "fraud_detection_rate_pct"]].mean()
    long_trend = trend.melt("Year", var_name="metric", value_name="rate_pct")
    plt.figure(figsize=(10, 6))
    sns.lineplot(data=long_trend, x="Year", y="rate_pct", hue="metric", marker="o")
    plt.ylabel("Mean rate (%)")
    plt.title("Risk, compliance, and fraud rates over time")
    plt.tight_layout()
    plt.savefig(OUTPUT / "rates_over_time.png", dpi=160)
    plt.close()
    plt.figure(figsize=(9, 7))
    sns.heatmap(data.select_dtypes("number").corr(), cmap="vlag", center=0, square=True)
    plt.title("Numeric variable correlations")
    plt.tight_layout()
    plt.savefig(OUTPUT / "correlation_heatmap.png", dpi=160)
    plt.close()


def write_report(data: pd.DataFrame, validation: dict[str, object]) -> None:
    ai = data.groupby("AI_Used_for_Auditing")[["fraud_detection_rate_pct", "Audit_Effectiveness_Score", "Client_Satisfaction_Score"]].mean()
    workload_corr = data[["Employee_Workload", "Audit_Effectiveness_Score", "Client_Satisfaction_Score"]].corr().loc["Employee_Workload"]
    firm_effectiveness = data.groupby("Firm_Name")["Audit_Effectiveness_Score"].mean()
    report = f"""# Big 4 Advanced Descriptive Analysis

Generated from `{validation['source']}` on `{validation['validated_at_utc']}`.

## Scope and validation

- {validation['rows']} observations and {validation['columns']} columns were analyzed.
- Required fields, missing values, duplicate rows, categorical values, nonnegative counts, score bounds, and high-risk denominators passed validation.
- Raw data was not modified. Derived rates use total audit engagements as the denominator.

## Key findings

- Mean fraud detection rate: **{data['fraud_detection_rate_pct'].mean():.2f}%**; mean compliance violation rate: **{data['compliance_violation_rate_pct'].mean():.2f}%**.
- Highest mean audit effectiveness: **{firm_effectiveness.idxmax()}** ({firm_effectiveness.max():.2f}/10).
- Workload correlations: effectiveness **{workload_corr['Audit_Effectiveness_Score']:.3f}**, satisfaction **{workload_corr['Client_Satisfaction_Score']:.3f}**.

## AI-use comparison

| AI used | Mean fraud detection rate (%) | Mean effectiveness | Mean satisfaction |
|---|---:|---:|---:|
""" + "\n".join(f"| {index} | {row['fraud_detection_rate_pct']:.2f} | {row['Audit_Effectiveness_Score']:.2f} | {row['Client_Satisfaction_Score']:.2f} |" for index, row in ai.iterrows()) + """

## Artifacts

- `enriched_data.csv`: row-level derived rates and burden metrics.
- `firm_summary.csv`, `year_summary.csv`, `industry_summary.csv`, `trend_table.csv`: grouped tables.
- `distribution_summary.csv`, `outlier_analysis.csv`, `correlation_matrix.csv`: distribution, IQR outlier, and correlation outputs.
- `fraud_detection_by_ai.png`, `rates_over_time.png`, `correlation_heatmap.png`: saved charts.

## Assumptions and risks

`Total_Revenue_Impact` units are treated as supplied by the source. Correlations and AI comparisons are descriptive, observational, and unweighted; they do not establish causation. The small sample and possible confounding by firm, year, and industry limit generalization.

## Study-purpose credits

This study uses the local VS Code workspace, its MCP workspace server, and the Codex/GitHub Copilot discussion bridge as development and analysis-support tools. Their use is credited for reproducibility and learning purposes; the generated findings are calculated from the supplied dataset and remain the responsibility of the analyst.

## Creation references

- [Local interactive dashboard](http://localhost:8501)
- [Bridge log: Codex unavailable](../../.agent-bridge/transcripts/2026-08-27T07-53-02.366Z.jsonl)
- [Bridge log: Codex unavailable](../../.agent-bridge/transcripts/2026-08-27T07-54-19.605Z.jsonl)
- [Bridge log: Codex unavailable](../../.agent-bridge/transcripts/2026-08-27T07-56-28.503Z.jsonl)
- [Bridge log: Copilot authentication required](../../.agent-bridge/transcripts/2026-08-27T08-05-02.991Z.jsonl)
- [Bridge log: availability check](../../.agent-bridge/transcripts/2026-08-27T08-07-43.176Z.jsonl)
"""
    (OUTPUT / "report.md").write_text(report, encoding="utf-8")


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Dataset not found: {SOURCE}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    frame = pd.read_csv(SOURCE)
    validation = validate(frame)
    data = enrich(frame)
    (OUTPUT / "validation.json").write_text(json.dumps(validation, indent=2), encoding="utf-8")
    data.to_csv(OUTPUT / "enriched_data.csv", index=False)
    save_grouped(data)
    save_distribution_and_outliers(data)
    data.select_dtypes("number").corr().to_csv(OUTPUT / "correlation_matrix.csv")
    ai = data.groupby("AI_Used_for_Auditing")[["fraud_detection_rate_pct", "Audit_Effectiveness_Score", "Client_Satisfaction_Score"]].agg(["mean", "median", "count"])
    ai.columns = ["_".join(column) for column in ai.columns]
    ai.reset_index().to_csv(OUTPUT / "ai_comparison.csv", index=False)
    data[["Employee_Workload", "Audit_Effectiveness_Score", "Client_Satisfaction_Score", "fraud_detection_rate_pct"]].corr().to_csv(OUTPUT / "workload_effectiveness_correlation.csv")
    save_charts(data)
    write_report(data, validation)
    print(f"Wrote advanced analysis artifacts to {OUTPUT}")


if __name__ == "__main__":
    main()