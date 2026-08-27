"""Interactive local dashboard for the Big 4 audit risk dataset."""

from pathlib import Path

import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from advanced_analysis import SOURCE, enrich, validate


st.set_page_config(page_title="Big 4 Risk Observatory", page_icon="📊", layout="wide")
st.title("Big 4 Risk Observatory")
st.caption("Interactive descriptive analysis of audit risk, compliance, fraud detection, and audit performance")

with st.expander("About this analysis and its creation references"):
    st.markdown(
        """
        **Objective.** Explore the Big 4 audit sample interactively while preserving a reproducible, descriptive analysis of risk, compliance, fraud detection, AI use, workload, and audit performance.

        **Solution.** The dashboard reads the validated raw CSV, applies the same derived rates as the batch pipeline, and presents filtered KPIs, firm/year/industry comparisons, trends, relationships, correlations, and downloadable records.

        **Operation.** Use the sidebar filters to change every view. The dashboard runs locally from `dashboard.py`; the batch outputs and detailed study note are saved under `outputs/advanced_analysis/`.

        **Study credit.** The local VS Code MCP workspace server and Codex/GitHub Copilot bridge were used as development and analysis-support tools. They are credited for study and reproducibility purposes, not treated as independent data sources.

        **Creation references.** [Detailed report note](outputs/advanced_analysis/discussion_note.md) · [Batch report](outputs/advanced_analysis/report.md) · [Saved communication logs](.agent-bridge/transcripts/)
        """
    )


@st.cache_data
def load_data():
    frame = __import__("pandas").read_csv(SOURCE)
    validate(frame)
    return enrich(frame)


data = load_data()
with st.sidebar:
    st.header("Explore the sample")
    firms = st.multiselect("Firms", sorted(data["Firm_Name"].unique()), default=sorted(data["Firm_Name"].unique()))
    years = st.slider("Years", int(data.Year.min()), int(data.Year.max()), (int(data.Year.min()), int(data.Year.max())))
    industries = st.multiselect("Industries", sorted(data["Industry_Affected"].unique()), default=sorted(data["Industry_Affected"].unique()))
    ai_options = st.multiselect("AI used for auditing", sorted(data["AI_Used_for_Auditing"].unique()), default=sorted(data["AI_Used_for_Auditing"].unique()))

filtered = data[
    data["Firm_Name"].isin(firms)
    & data["Year"].between(years[0], years[1])
    & data["Industry_Affected"].isin(industries)
    & data["AI_Used_for_Auditing"].isin(ai_options)
]

if filtered.empty:
    st.warning("No observations match the selected filters.")
    st.stop()

total_engagements = filtered["Total_Audit_Engagements"].sum()
metric_columns = st.columns(4)
metric_columns[0].metric("Audit engagements", f"{total_engagements:,.0f}")
metric_columns[1].metric("High-risk rate", f"{filtered['High_Risk_Cases'].sum() / total_engagements * 100:.2f}%")
metric_columns[2].metric("Compliance rate", f"{filtered['Compliance_Violations'].sum() / total_engagements * 100:.2f}%")
metric_columns[3].metric("Effectiveness", f"{filtered['Audit_Effectiveness_Score'].mean():.2f}/10")

overview, risk, relationships, records = st.tabs(["Overview", "Risk signals", "Relationships", "Records"])
with overview:
    left, right = st.columns(2)
    with left:
        firm = filtered.groupby("Firm_Name", as_index=False).agg(
            engagements=("Total_Audit_Engagements", "sum"),
            high_risk_rate=("high_risk_rate_pct", "mean"),
            effectiveness=("Audit_Effectiveness_Score", "mean"),
        )
        fig = px.bar(firm, x="Firm_Name", y="high_risk_rate", color="effectiveness",
                     labels={"high_risk_rate": "Mean high-risk rate (%)", "effectiveness": "Effectiveness"},
                     color_continuous_scale="Tealgrn", title="Risk rate and effectiveness by firm")
        st.plotly_chart(fig, width="stretch")
    with right:
        yearly = filtered.groupby("Year", as_index=False).agg(
            high_risk_rate=("high_risk_rate_pct", "mean"),
            compliance_rate=("compliance_violation_rate_pct", "mean"),
            fraud_rate=("fraud_detection_rate_pct", "mean"),
        ).melt("Year", var_name="signal", value_name="rate_pct")
        fig = px.line(yearly, x="Year", y="rate_pct", color="signal", markers=True,
                      labels={"rate_pct": "Mean rate (%)"}, title="Risk and detection signals over time")
        st.plotly_chart(fig, width="stretch")
    st.dataframe(firm.sort_values("high_risk_rate", ascending=False), hide_index=True, width="stretch")

with risk:
    left, right = st.columns(2)
    with left:
        fig = px.scatter(filtered, x="High_Risk_Cases", y="Compliance_Violations", size="Total_Audit_Engagements",
                         color="Firm_Name", symbol="AI_Used_for_Auditing", hover_data=["Year", "Industry_Affected", "Fraud_Cases_Detected"],
                         title="High-risk cases versus compliance violations")
        st.plotly_chart(fig, width="stretch")
    with right:
        industry = filtered.groupby("Industry_Affected", as_index=False).agg(
            high_risk_rate=("high_risk_rate_pct", "mean"),
            compliance_rate=("compliance_violation_rate_pct", "mean"),
            fraud_rate=("fraud_detection_rate_pct", "mean"),
        ).melt("Industry_Affected", var_name="signal", value_name="rate_pct")
        fig = px.bar(industry, x="Industry_Affected", y="rate_pct", color="signal", barmode="group",
                     labels={"rate_pct": "Mean rate (%)"}, title="Risk signals by industry")
        st.plotly_chart(fig, width="stretch")

with relationships:
    ai = filtered.groupby("AI_Used_for_Auditing", as_index=False).agg(
        fraud_rate=("fraud_detection_rate_pct", "mean"), effectiveness=("Audit_Effectiveness_Score", "mean"),
        satisfaction=("Client_Satisfaction_Score", "mean"), observations=("Year", "size"))
    st.subheader("AI-use comparison")
    st.dataframe(ai, hide_index=True, width="stretch")
    fig = px.scatter(filtered, x="Employee_Workload", y="Audit_Effectiveness_Score", color="AI_Used_for_Auditing",
                     hover_data=["Firm_Name", "Year", "Client_Satisfaction_Score"],
                     labels={"Employee_Workload": "Employee workload", "Audit_Effectiveness_Score": "Effectiveness (1-10)"},
                     title="Workload and audit effectiveness")
    st.plotly_chart(fig, width="stretch")
    correlation = filtered.select_dtypes("number").corr()
    fig = go.Figure(go.Heatmap(z=correlation.values, x=correlation.columns, y=correlation.columns, zmid=0, colorscale="RdBu"))
    fig.update_layout(title="Numeric correlation matrix", height=650)
    st.plotly_chart(fig, width="stretch")

with records:
    st.download_button("Download filtered CSV", filtered.to_csv(index=False), "filtered_big4_analysis.csv", "text/csv")
    st.dataframe(filtered, hide_index=True, width="stretch")
    st.caption(f"Showing {len(filtered):,} of {len(data):,} validated observations from {Path(SOURCE).name}.")