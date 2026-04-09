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
  MessageSquare,
  Bot,
  Workflow,
  Search,
  Image,
  Terminal,
  Server,
  Layers,
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
        id: 'ext-integrations',
        path: '/extensions/integrations',
        label: 'Integrations',
        icon: Network,
        component: ServiceMap,
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

export const coreExternalLinks = [
  { id: 'open-webui', label: 'Chat', port: 3000, icon: MessageSquare, healthNeedles: ['open-webui'] },
  { id: 'openclaw', label: 'OpenClaw', port: 7860, icon: Bot, healthNeedles: ['openclaw'] },
  { id: 'n8n', label: 'n8n Workflows', port: 5678, icon: Workflow, healthNeedles: ['n8n'] },
  { id: 'perplexica', label: 'Perplexica', port: 3004, icon: Search, healthNeedles: ['perplexica'] },
  { id: 'turnstone', label: 'Turnstone', port: 8080, icon: Layers, healthNeedles: ['turnstone'] },
  { id: 'comfyui', label: 'ComfyUI', port: 8188, icon: Image, healthNeedles: ['comfyui'] },
  { id: 'opencode', label: 'OpenCode', port: 3003, icon: Terminal, healthNeedles: ['opencode'] },
  { id: 'proxmox', label: 'Proxmox', port: 8006, icon: Server, alwaysHealthy: true, ui_path: '/' },
]
