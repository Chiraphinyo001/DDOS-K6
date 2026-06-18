import http from "k6/http";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("error_rate");
const responseTrend = new Trend("response_time");

export const options = {
  scenarios: {
    ramp_up: {
      executor: "ramping-arrival-rate",
      startRate: 1000,
      timeUnit: "1s",
      // เพิ่มบอทเริ่มต้นมารอไว้เลยเพื่อกระโดดข้ามขั้นตอนแตกตัว
      preAllocatedVUs: 5000, 
      // ขยายเพดานสูงสุดให้เยอะมาก (ระวังแรมเครื่องเต็ม)
      maxVUs: 40000, 
      stages: [
        { target: 10000, duration: "10s" }, // ไต่ไป 10,000
        { target: 45000, duration: "10s" }, // ไต่ไป 45,000
        { target: 90000, duration: "20s" }, // 🚀 ดันขึ้นจุดสูงสุดที่ 90,000 RPS
        { target: 90000, duration: "10s" }, // แช่ค้างไว้ที่ 90,000 RPS
        { target: 0,     duration: "10s" }, 
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000"], 
    http_req_failed:   ["rate<0.10"], // ยอมให้พังได้ไม่เกิน 10%
  },
};

// ตัดเครื่องหมาย # ออกตามที่คุยกัน เพื่อความถูกต้องของ URL
const TARGET_URL = "https://customer-flow-hub.botnoi-academy.workers.dev/";

export default function () {
  const res = http.get(TARGET_URL, {
    headers: {
      "User-Agent": "k6-extreme-load/1.0",
      // บังคับปิด Connection ทันทีเมื่อส่งเสร็จ ไม่ให้พอร์ตค้าง (ช่วยประหยัดพอร์ตใน Windows)
      "Connection": "close", 
    },
    timeout: "3s", // ลดทนเวลารอเหลือ 3 วินาที เพื่อให้เคลียร์คิวได้เร็วขึ้น
  });

  const success = check(res, {
    "status is 200": (r) => r.status === 200,
  });

  errorRate.add(!success);
  responseTrend.add(res.timings.duration);
}

export function handleSummary(data) {
  const reqs     = data.metrics.http_reqs?.values?.count ?? 0;
  const duration = data.metrics.http_req_duration?.values;
  const failed   = data.metrics.http_req_failed?.values?.rate ?? 0;

  console.log("\n============================");
  console.log("📊 สรุปผลการทดสอบ (เป้าหมาย 90,000 RPS)");
  console.log("============================");
  console.log(`📦 Request ทั้งหมดที่ส่งออกไป : ${reqs}`);
  console.log(`✅ Success Rate    : ${((1 - failed) * 100).toFixed(2)}%`);
  console.log(`❌ Error Rate      : ${(failed * 100).toFixed(2)}%`);
  if (duration) {
    console.log(`⏱️  Response Time (avg): ${duration.avg?.toFixed(2)}ms`);
  }
  console.log("============================\n");

  return {
    "summary.json": JSON.stringify(data, null, 2),
  };
}