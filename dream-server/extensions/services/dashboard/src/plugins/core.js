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
} from 'lucide-react'

const Dashboard = lazy(() => import('../pages/Dashboard'))
const SettingsPage = lazy(() => import('../pages/Settings'))
const Extensions = lazy(() => import('../pages/Extensions'))
const GPUMonitor = lazy(() => import('../pages/GPUMonitor'))
const Memory = lazy(() => import('../pages/Memory'))
const ModelLibrary = lazy(() => import('../pages/ModelLibrary'))
const InferenceAnalytics = lazy(() => import('../pages/InferenceAnalytics'))
const ServiceMap = lazy(() => import('../pages/ServiceMap'))

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
  {
    id: 'extensions',
    path: '/extensions',
    label: 'Extensions',
    icon: Puzzle,
    component: Extensions,
    getProps: () => ({}),
    sidebar: true,
    order: 3,
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
