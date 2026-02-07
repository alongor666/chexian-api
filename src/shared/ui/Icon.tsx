/**
 * Icon 组件封装
 * 统一的图标组件，基于 lucide-react
 */
import type { LucideIcon, LucideProps } from 'lucide-react'
import { memo } from 'react'

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

interface IconProps extends Omit<LucideProps, 'size'> {
  /** Lucide 图标组件 */
  icon: LucideIcon
  /** 图标尺寸 */
  size?: IconSize
  /** 自定义类名 */
  className?: string
  /** 可访问性标签 */
  'aria-label'?: string
}

const sizeMap: Record<IconSize, number> = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
}

/**
 * 通用图标组件
 * @example
 * import { Search, Settings } from 'lucide-react'
 * <Icon icon={Search} size="md" className="text-primary" />
 */
export const Icon = memo(function Icon({
  icon: IconComponent,
  size = 'md',
  className = '',
  'aria-label': ariaLabel,
  ...props
}: IconProps) {
  return (
    <IconComponent
      size={sizeMap[size]}
      className={`inline-block flex-shrink-0 ${className}`}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      {...props}
    />
  )
})

// 导出常用图标的快捷组件
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
} from 'lucide-react'
