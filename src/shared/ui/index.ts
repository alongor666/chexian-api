/**
 * 统一 UI 组件库
 *
 * 提供项目通用的基础 UI 组件，确保样式一致性。
 * 所有功能模块应优先使用这些组件。
 */

// ============================================================================
// 基础组件
// ============================================================================

// Card 卡片
export {
  Card,
  CardDivider,
  CardFooter,
  StatCard,
} from './Card'
export type {
  CardProps,
  CardVariant,
  CardPadding,
  StatCardProps,
} from './Card'

// Button 按钮
export {
  Button,
  IconButton,
  ButtonGroup,
} from './Button'
export type {
  ButtonProps,
  ButtonVariant,
  ButtonSize,
  IconButtonProps,
  ButtonGroupProps,
} from './Button'

// Badge 徽章
export {
  Badge,
  StatusBadge,
  CountBadge,
  TagGroup,
} from './Badge'
export type {
  BadgeProps,
  BadgeVariant,
  BadgeSize,
  StatusBadgeProps,
  StatusBadgeStatus,
  CountBadgeProps,
  TagGroupProps,
} from './Badge'

// Input 输入框
export {
  Input,
  SearchInput,
  PasswordInput,
  TextArea,
  FormItem,
} from './Input'
export type {
  InputProps,
  InputSize,
  InputStatus,
  SearchInputProps,
  PasswordInputProps,
  TextAreaProps,
  FormItemProps,
} from './Input'

// Select 选择器
export {
  Select,
  NativeMultiSelect,
  OptGroup,
} from './Select'
export type {
  SelectProps,
  SelectOption,
  SelectSize,
  SelectStatus,
  MultiSelectProps,
} from './Select'

// Table 表格
export {
  Table,
  NumericCell,
  TrendCell,
  StatusCell,
} from './Table'
export type {
  TableProps,
  TableColumn,
  TableSize,
  SortDirection,
} from './Table'

// Tabs 标签页
export { Tabs } from './Tabs'
export type { TabsProps, TabItem } from './Tabs'

// Icon 图标
export { Icon } from './Icon'
export type { IconSize } from './Icon'

// 从 lucide-react 重新导出常用图标
export {
  // 导航和操作
  Search,
  Settings,
  Menu,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  // 状态指示
  CheckCircle,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Info,
  // 文件和数据
  FileText,
  FolderOpen,
  Download,
  Upload,
  Save,
  Trash2,
  Copy,
  // 图表相关
  BarChart3,
  LineChart,
  PieChart,
  TrendingUp,
  TrendingDown,
  // 用户和组织
  User,
  Users,
  Building,
  Building2,
  // 时间和日历
  Calendar,
  Clock,
  // 刷新和加载
  RefreshCw,
  Loader2,
  // 其他常用
  Play,
  Pause,
  Star,
  Heart,
  Eye,
  EyeOff,
  Filter,
  SlidersHorizontal,
  MoreHorizontal,
  MoreVertical,
  Plus,
  Minus,
  Edit,
  Pencil,
  ExternalLink,
  Link,
  Maximize2,
  Minimize2,
  // 车险业务相关
  Car,
  Truck,
  Shield,
  FileCheck,
  Calculator,
  Percent,
  DollarSign,
  CreditCard,
  Receipt,
  ClipboardList,
  Target,
  Award,
  Gauge,
  Activity,
} from './Icon'

// Skeleton 骨架屏
export {
  Skeleton,
  KpiCardSkeleton,
  KpiGridSkeleton,
  TableSkeleton,
  ChartSkeleton,
  FilterSkeleton,
  DashboardSkeleton,
  ListItemSkeleton,
  ListSkeleton,
} from './Skeleton'

// 布局组件
export { PageWithRightFilter } from './PageWithRightFilter'

// ============================================================================
// 续保分析组件
// ============================================================================

// RenewalStatusBadge 续保率状态徽章
export {
  RenewalStatusBadge,
  getRenewalStatus,
  getRenewalRowBgClass,
  getRenewalStatusLabel,
  DEFAULT_RENEWAL_THRESHOLDS,
} from './RenewalStatusBadge'
export type {
  RenewalStatus,
  RenewalStatusBadgeProps,
  RenewalThresholds,
} from './RenewalStatusBadge'

// FunnelIndicator 轻量级漏斗指示器
export { FunnelIndicator } from './FunnelIndicator'
export type { FunnelIndicatorProps } from './FunnelIndicator'

// ============================================================================
// 样式工具
// ============================================================================

export {
  // 颜色
  colors,
  // 间距
  spacing,
  // 字体
  fontSize,
  // 圆角
  borderRadius,
  // 阴影
  boxShadow,
  // 过渡
  transition,
  // 组件样式类
  cardStyles,
  buttonStyles,
  badgeStyles,
  inputStyles,
  tableStyles,
  textStyles,
  layoutStyles,
  stateStyles,
  // 工具函数
  cn,
  conditionalStyle,
  getTrendColorClass,
  getStatusColorClass,
  getStatusBgClass,
} from '../styles'
