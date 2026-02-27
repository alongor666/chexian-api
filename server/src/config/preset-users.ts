export interface PresetUser {
  username: string;
  passwordHash: string;
  displayName: string;
  role: string;
  organization?: string;
  allowedRoutes?: string[];
  defaultRoute?: string;
  allowedIps?: string[];
  active?: boolean;
}

export interface PresetRole {
  role: string;
  name: string;
  dataScope: 'all' | 'org' | 'telemarketing';
  allowedRoutes?: string[];
  defaultRoute?: string;
}

export const PRESET_ROLES: PresetRole[] = [
  { role: 'branch_admin', name: '分公司管理员', dataScope: 'all' },
  { role: 'org_user', name: '三级机构用户', dataScope: 'org' },
  { role: 'telemarketing_user', name: '电销用户', dataScope: 'telemarketing' },
];

export const PRESET_USERS: Record<string, PresetUser> = {
  admin: {
    username: 'admin',
    passwordHash: '$2b$10$APRNUh5SQwF3N7Ew0TbM/OuZJ6mnB6FgPvxni5OXiejDCDfQlJIRW',
    displayName: '系统管理员',
    role: 'branch_admin',
  },
  leshan: {
    username: 'leshan',
    passwordHash: '$2b$10$zg8QffrtojxjkuOuncgtG.SLPAbOsuS29USERwXVNlbs9suHdFihe',
    displayName: '乐山机构',
    role: 'org_user',
    organization: '乐山',
  },
  tianfu: {
    username: 'tianfu',
    passwordHash: '$2b$10$UDpOw8NOHWEokrdBlbZHRecw9cPnYFwevi.AZ5w5s0rywxH737zv.',
    displayName: '天府机构',
    role: 'org_user',
    organization: '天府',
  },
  yibin: {
    username: 'yibin',
    passwordHash: '$2b$10$bE6z5mFnpLIkH3Q/xxAV0ecRuAnQH8hls9Tk0RLxkbQc6ue0X/tCy',
    displayName: '宜宾机构',
    role: 'org_user',
    organization: '宜宾',
  },
  deyang: {
    username: 'deyang',
    passwordHash: '$2b$10$Ibn1z1Z3mlpCzV2Uxa7IzO6eDvvmd4zan65yrVaLtqLGhqj04XN92',
    displayName: '德阳机构',
    role: 'org_user',
    organization: '德阳',
  },
  xindu: {
    username: 'xindu',
    passwordHash: '$2b$10$MN/5HppLscWDiXbqgmxJH.f3pO3x3/JU38xkKtTr.ERFDXiKU7nPe',
    displayName: '新都机构',
    role: 'org_user',
    organization: '新都',
  },
  wuhou: {
    username: 'wuhou',
    passwordHash: '$2b$10$AC8yYRbjP9sep/CP3O7KPey/FgqpxY55ChPUzsyp.DGoYsveSW/Zy',
    displayName: '武侯机构',
    role: 'org_user',
    organization: '武侯',
  },
  luzhou: {
    username: 'luzhou',
    passwordHash: '$2b$10$Ca0AjfYyulOjBb3II5qkg.KrbZ6ZvPSS64tHLya7gfHNt5YmZuoCK',
    displayName: '泸州机构',
    role: 'org_user',
    organization: '泸州',
  },
  zigong: {
    username: 'zigong',
    passwordHash: '$2b$10$RjJSNiUzFUDQzsgSQyxoP.mQgzZiQTOZmiTCbt7./Uw2LDe0KwOy2',
    displayName: '自贡机构',
    role: 'org_user',
    organization: '自贡',
  },
  ziyang: {
    username: 'ziyang',
    passwordHash: '$2b$10$ilZd3i9kJuxq8AreozLABuqycttUPyzzDg4J3PI3pgohJFMMd40b.',
    displayName: '资阳机构',
    role: 'org_user',
    organization: '资阳',
  },
  dazhou: {
    username: 'dazhou',
    passwordHash: '$2b$10$DJdJxQxlnHDKuARwaMFZkuGlzP7PUgcy9HrfZRz/kGDv2qa/lZDIe',
    displayName: '达州机构',
    role: 'org_user',
    organization: '达州',
  },
  qingyang: {
    username: 'qingyang',
    passwordHash: '$2b$10$UaIDl3P3r5LsT9m.K23JXeg3MnUq7U40UPNjqFeuCKQhCVLFufiAW',
    displayName: '青羊机构',
    role: 'org_user',
    organization: '青羊',
  },
  gaoxin: {
    username: 'gaoxin',
    passwordHash: '$2b$10$uOtJ/1ctlLBNEzmQnhYXIuq.vYsn8VR3kcskjEY3vCUUsI/xQ.Sty',
    displayName: '高新机构',
    role: 'org_user',
    organization: '高新',
  },
  jiachengxian: {
    username: 'jiachengxian',
    passwordHash: '$2b$10$gy9XfxPHgbFrdSJfFrTtW.tu3kRzGYsPxGRrtvMyleCGNTpdTDhL6',
    displayName: 'jiachengxian',
    role: 'branch_admin',
  },
  xuechenglong: {
    username: 'xuechenglong',
    passwordHash: '$2b$10$NHIOCyjuqXWLXyq5UaP8Y.5p/NNsDMXBrsnk/eHsmq.tVSd0swcwu',
    displayName: '薛成龙',
    role: 'branch_admin',
  },
  linxia: {
    username: 'linxia',
    passwordHash: '$2b$10$IPuFIhlNl6NFLXSC8A4o4.tuqMsK9J7B6D5DbeKzpOnJtE9uLA/BO',
    displayName: '林霞',
    role: 'branch_admin',
  },
  chexianbu: {
    username: 'chexianbu',
    passwordHash: '$2b$10$MNXiN2ASW4I1h.uqWRKySuQH80CmVCn1wjnXbXWzV5ersVLcoE4wu',
    displayName: '车险部',
    role: 'branch_admin',
  },
  scdianxiao: {
    username: 'scdianxiao',
    passwordHash: '$2b$10$LGsDuG1.fieDoR/mbsII1u2ecFY0iteEyFMKkgzO98OKfdbUAj4cK',
    displayName: '四川电销',
    role: 'telemarketing_user',
  },
};
