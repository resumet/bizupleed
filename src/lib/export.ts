import ExcelJS from "exceljs";
import { formatPhone, maskPhone } from "./crypto";
import { fieldsOf, LeadView, utmOf } from "./leads";

const kst = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

/** 리드 목록을 xlsx 로 만든다. 문자열 셀로만 기록하므로 수식 주입 위험이 없다. */
export async function leadsToXlsx(leads: LeadView[], opts: { maskPhone?: boolean } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("리드");
  const extraKeys = [...new Set(leads.flatMap((l) => Object.keys(fieldsOf(l))))];
  ws.columns = [
    { header: "신청일시", width: 18 }, { header: "고객사", width: 16 }, { header: "캠페인", width: 20 }, { header: "랜딩", width: 20 },
    { header: "이름", width: 12 }, { header: "연락처", width: 16 }, { header: "이메일", width: 24 }, { header: "상태", width: 12 },
    { header: "담당자", width: 12 }, { header: "유입", width: 12 }, { header: "매체", width: 12 }, { header: "UTM 캠페인", width: 18 },
    { header: "중복", width: 6 }, { header: "허수", width: 6 }, { header: "광고수신동의", width: 12 },
    ...extraKeys.map((k) => ({ header: k, width: 20 })),
  ];
  ws.getRow(1).font = { bold: true };
  for (const l of leads) {
    const f = fieldsOf(l);
    ws.addRow([
      kst(l.submitted_at), l.client_name, l.campaign_title, l.landing_name, l.name,
      l.phone ? (opts.maskPhone ? maskPhone(l.phone) : formatPhone(l.phone)) : "", l.email, l.status_label, l.owner_name ?? "",
      l.source ?? "", l.medium ?? "", utmOf(l).utm_campaign ?? "", l.is_duplicate ? "Y" : "", l.is_invalid ? "Y" : "", l.marketing_consent ? "Y" : "",
      ...extraKeys.map((k) => f[k] ?? ""),
    ].map((v) => String(v)));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(buf: Buffer, name: string): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
}
