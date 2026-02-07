/**
 * 2026年中国法定节假日及周末数据
 *
 * 数据来源：国务院办公厅发布的节假日安排 + 周末（周六/周日）
 * 用途：营销战报板块假日营销分析
 */

export interface Holiday {
  /** 节假日名称 */
  name: string;
  /** 日期字符串 YYYY-MM-DD */
  date: string;
}

/**
 * 生成指定年份的所有周末日期
 * @param year 年份
 * @returns 周末日期数组
 */
function generateWeekends(year: number): Holiday[] {
  const weekends: Holiday[] = [];
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  const formatLocalYMD = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      // 周日或周六
      const dateStr = formatLocalYMD(d);
      weekends.push({
        name: dayOfWeek === 6 ? '周六' : '周日',
        date: dateStr,
      });
    }
  }
  return weekends;
}

/**
 * 2026年中国法定节假日列表
 * 包含：元旦、春节、清明节、劳动节、端午节、中秋节、国庆节
 */
const LEGAL_HOLIDAYS_2026: Holiday[] = [
  // 元旦（1月1日）
  { name: '元旦', date: '2026-01-01' },

  // 春节（1月28日-2月3日，共7天）
  { name: '春节', date: '2026-01-28' },
  { name: '春节', date: '2026-01-29' },
  { name: '春节', date: '2026-01-30' },
  { name: '春节', date: '2026-01-31' },
  { name: '春节', date: '2026-02-01' },
  { name: '春节', date: '2026-02-02' },
  { name: '春节', date: '2026-02-03' },

  // 清明节（4月4-6日，共3天）
  { name: '清明节', date: '2026-04-04' },
  { name: '清明节', date: '2026-04-05' },
  { name: '清明节', date: '2026-04-06' },

  // 劳动节（5月1日-5月5日，共5天）
  { name: '劳动节', date: '2026-05-01' },
  { name: '劳动节', date: '2026-05-02' },
  { name: '劳动节', date: '2026-05-03' },
  { name: '劳动节', date: '2026-05-04' },
  { name: '劳动节', date: '2026-05-05' },

  // 端午节（5月31日-6月2日，共3天）
  { name: '端午节', date: '2026-05-31' },
  { name: '端午节', date: '2026-06-01' },
  { name: '端午节', date: '2026-06-02' },

  // 中秋节（9月27-29日，共3天）
  { name: '中秋节', date: '2026-09-27' },
  { name: '中秋节', date: '2026-09-28' },
  { name: '中秋节', date: '2026-09-29' },

  // 国庆节（10月1日-10月7日，共7天）
  { name: '国庆节', date: '2026-10-01' },
  { name: '国庆节', date: '2026-10-02' },
  { name: '国庆节', date: '2026-10-03' },
  { name: '国庆节', date: '2026-10-04' },
  { name: '国庆节', date: '2026-10-05' },
  { name: '国庆节', date: '2026-10-06' },
  { name: '国庆节', date: '2026-10-07' },
];

/**
 * 2026年周末列表（周六、周日）
 */
const WEEKENDS_2026: Holiday[] = generateWeekends(2026);

/**
 * 合并法定节假日和周末，去除重复日期
 * 当日期重复时，保留法定节假日名称（优先级更高）
 */
function mergeHolidaysAndWeekends(
  legalHolidays: Holiday[],
  weekends: Holiday[]
): Holiday[] {
  // 创建法定节假日日期集合
  const legalHolidayDates = new Set(legalHolidays.map((h) => h.date));

  // 过滤掉与法定节假日重复的周末
  const filteredWeekends = weekends.filter(
    (w) => !legalHolidayDates.has(w.date)
  );

  // 合并并按日期排序
  return [...legalHolidays, ...filteredWeekends].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

/**
 * 2026年完整节假日列表（法定节假日 + 周末）
 * - 法定节假日：29天
 * - 周末：104天（52周 × 2）
 * - 去重后合计约120+天（部分法定假日与周末重叠）
 */
export const HOLIDAYS_2026: Holiday[] = mergeHolidaysAndWeekends(
  LEGAL_HOLIDAYS_2026,
  WEEKENDS_2026
);

/**
 * 仅法定节假日列表（不含周末）
 */
export const LEGAL_HOLIDAYS_ONLY_2026 = LEGAL_HOLIDAYS_2026;

/**
 * 节假日日期集合（用于快速查找）
 */
export const HOLIDAY_SET = new Set(HOLIDAYS_2026.map((h) => h.date));

/**
 * 按节假日名称分组的日期映射
 */
export const HOLIDAYS_BY_NAME = HOLIDAYS_2026.reduce(
  (acc, holiday) => {
    if (!acc[holiday.name]) {
      acc[holiday.name] = [];
    }
    acc[holiday.name].push(holiday.date);
    return acc;
  },
  {} as Record<string, string[]>
);

/**
 * 获取节假日名称列表（去重）
 */
export const HOLIDAY_NAMES = Object.keys(HOLIDAYS_BY_NAME);
