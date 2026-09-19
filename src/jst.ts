// 日本時間の暦日ユーティリティ。期限の比較・表示はすべてJSTの暦日(YYYY-MM-DD)で行う。
// "sv-SE"ロケールはISO形式(YYYY-MM-DD)を返すための定番トリック
const formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" });

export function jstDate(date: Date = new Date()): string {
  return formatter.format(date);
}

export function jstDateAfter(days: number): string {
  return formatter.format(new Date(Date.now() + days * 86_400_000));
}
