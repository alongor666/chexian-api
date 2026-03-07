import jwt from 'jsonwebtoken';

const token = jwt.sign(
    { userId: 'test', username: 'test', role: 'branch_admin', organization: '本部' },
    process.env.JWT_SECRET || 'change-me-in-production'
);

const url = 'http://localhost:3000/api/query/performance-org-heatmap?dateField=policy_date&startDate=2026-01-01&endDate=2026-03-04&segmentTag=all&growthMode=mom&timePeriod=day&groupByDimension=org_level_3';

async function run() {
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const text = await res.text();
        console.log("RESPONSE HTTP", res.status);
        console.log("RESPONSE BODY:", text);
    } catch (e) {
        console.error("Fetch err", e);
    }
}
run();
