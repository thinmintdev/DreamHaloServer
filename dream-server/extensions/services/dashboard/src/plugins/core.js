import { lazy } from 'react'
import {
  LayoutDashboard,
  Settings,
  Puzzle,
  Activity,
  Brain,
  Database,
  BarChart2,
  Network,
  Container,
  ScrollText,
  LayoutTemplate,
} from 'lucide-react'

const Dashboard = lazy(() => import('../pages/Dashboard'))
const SettingsPage = lazy(() => import('../pages/Settings'))
const Extensions = lazy(() => import('../pages/Extensions'))
const GPUMonitor = lazy(() => import('../pages/GPUMonitor'))
const Memory = lazy(() => import('../pages/Memory'))
const ModelLibrary = lazy(() => import('../pages/ModelLibrary'))
const InferenceAnalytics = lazy(() => import('../pages/InferenceAnalytics'))
const ServiceMap = lazy(() => import('../pages/ServiceMap'))
const Services = lazy(() => import('../pages/Services'))
const Logs = lazy(() => import('../pages/Logs'))

export const coreRoutes = [
  {
    id: 'dashboard',
    path: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    component: Dashboard,
    getProps: ({ status, loading }) => ({ status, loading }),
    sidebar: true,
    order: 0,
  },
  {
    id: 'gpu-monitor',
    path: '/gpu',
    label: 'GPU Monitor',
    icon: Activity,
    component: GPUMonitor,
    getProps: () => ({}),
    // Route is always registered; sidebar entry only appears on multi-GPU systems
    sidebar: ({ status }) => (status?.gpu?.gpu_count || 1) > 1,
    order: 1,
  },
  {
    id: 'inference',
    path: '/inference',
    label: 'Inference',
    icon: BarChart2,
    component: InferenceAnalytics,
    getProps: () => ({}),
    sidebar: false,
    order: 1.5,
  },
  {
    id: 'memory',
    path: '/memory',
    label: 'Memory',
    icon: Brain,
    component: Memory,
    getProps: () => ({}),
    sidebar: true,
    order: 2,
  },
  {
    id: 'model-library',
    path: '/model-library',
    label: 'Model Library',
    icon: Database,
    component: ModelLibrary,
    getProps: () => ({}),
    sidebar: true,
    order: 2.5,
  },
  {
    id: 'service-map',
    path: '/service-map',
    label: 'Service Map',
    icon: Network,
    component: ServiceMap,
    getProps: () => ({}),
    sidebar: true,
    order: 2.8,
  },
  // --- Extensions group (expandable in sidebar) ---
  {
    id: 'extensions',
    path: '/extensions',
    label: 'Extensions',
    icon: Puzzle,
    component: null, // parent group — redirects to /extensions/services
    sidebar: true,
    order: 3,
    group: 'extensions',
    children: [
      {
        id: 'ext-services',
        path: '/extensions/services',
        label: 'Services',
        icon: Container,
        component: Services,
        getProps: () => ({}),
      },
      {
        id: 'ext-templates',
        path: '/extensions/templates',
        label: 'Templates',
        icon: LayoutTemplate,
        component: Extensions,
        getProps: () => ({}),
      },
      {
        id: 'ext-logs',
        path: '/extensions/logs',
        label: 'Logs',
        icon: ScrollText,
        component: Logs,
        getProps: () => ({}),
      },
    ],
  },
  {
    id: 'settings',
    path: '/settings',
    label: 'Settings',
    icon: Settings,
    component: SettingsPage,
    getProps: () => ({}),
    sidebar: true,
    order: 99,
  },
]

export const coreExternalLinks = []
