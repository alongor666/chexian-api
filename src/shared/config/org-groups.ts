/**
 * 机构分组配置
 *
 * 从 coefficient-thresholds.ts 迁移而来，供交叉销售模块使用。
 * 与系数监控功能无关，是通用业务常量。
 *
 * 多省扩展：ORG_GROUPS_BY_BRANCH[branchCode] 取对应省分组；
 * ORG_GROUPS 保留为 SC（四川）别名，向后兼容。
 */

/** 各省机构分组（SC=四川，SX=山西） */
export const ORG_GROUPS_BY_BRANCH: Record<string, { readonly SAME_CITY: readonly string[]; readonly REMOTE: readonly string[] }> = {
  SC: {
    /** 同城机构（成都） */
    SAME_CITY: ['天府', '高新', '新都', '青羊', '武侯', '重客', '本部'],
    /** 异地机构（中支） */
    REMOTE: ['宜宾', '德阳', '资阳', '泸州', '自贡', '乐山', '达州'],
  },
  SX: {
    /** 同城机构（太原） */
    SAME_CITY: ['太原一部', '太原二部', '经代、车商、重客'],
    /** 异地机构（省内中支） */
    REMOTE: ['临汾', '吕梁', '大同', '晋中', '晋城', '运城', '长治', '阳泉'],
  },
};

/** 向后兼容：四川机构分组（ORG_GROUPS_BY_BRANCH.SC 的别名） */
export const ORG_GROUPS = ORG_GROUPS_BY_BRANCH.SC;
