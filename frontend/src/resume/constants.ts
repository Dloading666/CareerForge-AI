import type {
  BasicFieldType,
  BasicFieldKey,
  Certificate,
  CustomFieldType,
  CustomItem,
  Education,
  Experience,
  GlobalSettings,
  MenuSection,
  PhotoConfig,
  Project,
  ResumeData,
  ResumeSectionId,
} from './types'
import { textareaToListHtml, textareaToParagraphHtml } from './utils/content'

const DEFAULT_SECTIONS: MenuSection[] = [
  { id: 'basic', title: '基本信息', icon: '👤', enabled: true, order: 0 },
  { id: 'skills', title: '专业技能', icon: '⚡', enabled: true, order: 1 },
  { id: 'experience', title: '工作经历', icon: '💼', enabled: true, order: 2 },
  { id: 'projects', title: '项目经历', icon: '🚀', enabled: true, order: 3 },
  { id: 'education', title: '教育经历', icon: '🎓', enabled: true, order: 4 },
  { id: 'selfEvaluation', title: '自我评价', icon: '📝', enabled: true, order: 5 },
]

export const TEMPLATE_LABELS: Record<string, string> = {
  classic: '经典模板',
  modern: '两栏布局',
  elegant: '优雅模板',
  'left-right': '模块标题背景色',
  timeline: '时间轴布局',
  minimalist: '极简模板',
  creative: '创意模板',
  editorial: '画报风',
  swiss: '瑞士美学',
}

export const DEFAULT_BASIC_FIELD_ORDER: BasicFieldType[] = [
  { id: 'name', key: 'name', label: '姓名', type: 'text', visible: true },
  { id: 'title', key: 'title', label: '职位', type: 'text', visible: true },
  { id: 'birthDate', key: 'birthDate', label: '生日', type: 'date', visible: true },
  { id: 'employementStatus', key: 'employementStatus', label: '状态', type: 'text', visible: true },
  { id: 'email', key: 'email', label: '邮箱', type: 'text', visible: true },
  { id: 'phone', key: 'phone', label: '电话', type: 'text', visible: true },
  { id: 'location', key: 'location', label: '地址', type: 'text', visible: true },
]

export const DEFAULT_BASIC_ICONS: Partial<Record<BasicFieldKey, string>> = {
  birthDate: 'calendar',
  employementStatus: 'briefcase',
  email: 'mail',
  phone: 'phone',
  location: 'location',
}

export const DEFAULT_PHOTO_CONFIG: PhotoConfig = {
  width: 90,
  height: 120,
  aspectRatio: '1:1',
  borderRadius: 'none',
  customBorderRadius: 0,
  visible: true,
}

export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function cloneBasicFieldOrder() {
  return DEFAULT_BASIC_FIELD_ORDER.map((field) => ({ ...field }))
}

export function createCustomField(): CustomFieldType {
  return {
    id: createId('custom'),
    label: '',
    value: '',
    icon: 'globe',
    visible: true,
    custom: true,
    displayLabel: false,
  }
}

export function createEducation(): Education {
  return {
    id: createId('edu'),
    school: '',
    major: '',
    degree: '',
    startDate: '',
    endDate: '',
    gpa: '',
    description: '',
    visible: true,
  }
}

export function createExperience(): Experience {
  return {
    id: createId('exp'),
    company: '',
    position: '',
    date: '',
    details: '',
    visible: true,
  }
}

export function createProject(): Project {
  return {
    id: createId('proj'),
    name: '',
    role: '',
    date: '',
    description: '',
    visible: true,
    link: '',
    linkLabel: '',
  }
}

export function createCertificate(): Certificate {
  return {
    id: createId('cert'),
    url: '',
    width: 100,
  }
}

export function createCustomItem(): CustomItem {
  return {
    id: createId('section'),
    title: '',
    subtitle: '',
    dateRange: '',
    description: '',
    visible: true,
  }
}

export function getDefaultGlobalSettings(templateId: ResumeData['templateId'] = 'classic'): GlobalSettings {
  if (templateId === 'modern') {
    return {
      themeColor: '#000000',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 0,
      lineHeight: 1.5,
      sectionSpacing: 8,
      paragraphSpacing: 4,
      headerSize: 18,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: true,
    }
  }
  if (templateId === 'elegant') {
    return {
      themeColor: '#18181b',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 32,
      lineHeight: 1.5,
      sectionSpacing: 28,
      paragraphSpacing: 18,
      headerSize: 20,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: true,
    }
  }
  if (templateId === 'left-right') {
    return {
      themeColor: '#2563eb',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 32,
      lineHeight: 1.5,
      sectionSpacing: 24,
      paragraphSpacing: 16,
      headerSize: 18,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: false,
    }
  }
  if (templateId === 'timeline') {
    return {
      themeColor: '#18181b',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 24,
      lineHeight: 1.5,
      sectionSpacing: 1,
      paragraphSpacing: 12,
      headerSize: 18,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: false,
    }
  }
  if (templateId === 'minimalist') {
    return {
      themeColor: '#171717',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 40,
      lineHeight: 1.5,
      sectionSpacing: 32,
      paragraphSpacing: 24,
      headerSize: 16,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: true,
    }
  }
  if (templateId === 'creative') {
    return {
      themeColor: '#7c3aed',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 14,
      lineHeight: 1.5,
      sectionSpacing: 16,
      paragraphSpacing: 16,
      headerSize: 16,
      subheaderSize: 16,
      useIconMode: false,
      centerSubtitle: false,
    }
  }
  if (templateId === 'editorial') {
    return {
      themeColor: '#8e8e8e',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 36,
      lineHeight: 1.5,
      sectionSpacing: 32,
      paragraphSpacing: 16,
      headerSize: 13,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: false,
    }
  }
  if (templateId === 'swiss') {
    return {
      themeColor: '#E31C24',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 36,
      lineHeight: 1.5,
      sectionSpacing: 36,
      paragraphSpacing: 12,
      headerSize: 18,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: false,
    }
  }
  return {
    themeColor: '#000000',
    fontFamily: '"Alibaba PuHuiTi", sans-serif',
    baseFontSize: 16,
    pagePadding: 32,
    lineHeight: 1.5,
    sectionSpacing: 16,
    paragraphSpacing: 12,
    headerSize: 18,
    subheaderSize: 16,
    useIconMode: true,
    centerSubtitle: true,
  }
}

export function createEmptyResumeDocument(templateId: ResumeData['templateId'] = 'classic'): Omit<ResumeData, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    title: '新建简历',
    templateId,
    visibility: false,
    basic: {
      name: '',
      title: '',
      employementStatus: '',
      email: '',
      phone: '',
      location: '',
      birthDate: '',
      icons: DEFAULT_BASIC_ICONS as Record<string, string>,
      photo: '',
      photoConfig: { ...DEFAULT_PHOTO_CONFIG },
      fieldOrder: cloneBasicFieldOrder(),
      customFields: [],
      githubKey: '',
      githubUseName: '',
      githubContributionsVisible: false,
    },
    education: [createEducation()],
    experience: [],
    projects: [],
    certificates: [],
    customData: {},
    skillContent: '',
    selfEvaluationContent: '',
    activeSection: 'basic',
    draggingProjectId: null,
    globalSettings: getDefaultGlobalSettings(templateId),
    menuSections: DEFAULT_SECTIONS,
  }
}

export function createTemplateResumeDocument(templateId: ResumeData['templateId'] = 'classic'): Omit<ResumeData, 'id' | 'createdAt' | 'updatedAt'> {
  return ensureResumeDefaults({
    title: '新建简历',
    templateId,
    visibility: false,
    basic: {
      name: '吴少然',
      title: '高级前端工程师',
      employementStatus: '离职',
      email: 'zhangsan@example.com',
      phone: '13800138000',
      location: '北京市朝阳区',
      birthDate: '2025-01',
      icons: DEFAULT_BASIC_ICONS as Record<string, string>,
      photo: '/resume-template-avatar.png',
      photoConfig: { ...DEFAULT_PHOTO_CONFIG },
      fieldOrder: cloneBasicFieldOrder(),
      customFields: [
        {
          id: 'website-demo',
          label: '个人网站',
          value: 'https://zhangsan.dev',
          icon: 'globe',
          visible: true,
          custom: true,
          displayLabel: false,
        },
      ],
      githubKey: '',
      githubUseName: '',
      githubContributionsVisible: false,
    },
    education: [
      {
        id: 'edu-demo-1',
        school: '北京大学',
        major: '计算机科学与技术',
        degree: '',
        startDate: '2013-09',
        endDate: '2017-06',
        gpa: '',
        description: textareaToListHtml(
          '主修课程：数据结构、算法设计、操作系统、计算机网络、Web开发技术\n专业排名前 5%，连续三年获得一等奖学金\n担任计算机协会技术部部长，组织多次技术分享会\n参与开源项目贡献，获得 GitHub Campus Expert 认证',
        ),
        visible: true,
      },
    ],
    experience: [
      {
        id: 'exp-demo-1',
        company: '字节跳动',
        position: '高级前端工程师',
        date: '2021.07 - 2024.12',
        details: textareaToListHtml(
          '负责抖音创作者平台的开发与维护，主导多个核心功能的技术方案设计\n优化项目工程化配置，将构建时间从 8 分钟优化至 2 分钟，提升团队开发效率\n设计并实现组件库，提升代码复用率达 70%，显著减少开发时间\n主导性能优化项目，使平台首屏加载时间减少 50%，接入 APM 监控系统\n指导初级工程师，组织技术分享会，提升团队整体技术水平',
        ),
        visible: true,
      },
    ],
    projects: [
      {
        id: 'proj-demo-1',
        name: '抖音创作者中台',
        role: '前端负责人',
        date: '2022.06 - 2023.12',
        description: textareaToListHtml(
          '基于 React 开发的创作者数据分析和内容管理平台，服务百万级创作者群体\n包含数据分析、内容管理、收益管理等多个子系统\n使用 Redux 进行状态管理，实现复杂数据流的高效处理\n采用 Ant Design 组件库，确保界面设计的一致性和用户体验\n实施代码分割和懒加载策略，优化大规模应用的加载性能',
        ),
        visible: true,
        link: '',
        linkLabel: '',
      },
      {
        id: 'proj-demo-2',
        name: '微信小程序开发者工具',
        role: '核心开发者',
        date: '2020.03 - 2021.06',
        description: textareaToListHtml(
          '为开发者提供小程序开发、调试和发布的一站式解决方案\n基于 Electron 构建跨平台桌面应用\n支持 Windows、macOS 和 Linux 多平台开发\n提供实时的错误日志和性能分析工具\n集成第三方插件和 SDK，支持开发者自定义功能',
        ),
        visible: true,
        link: '',
        linkLabel: '',
      },
    ],
    certificates: [],
    customData: {},
    skillContent: textareaToListHtml(
      '前端框架：熟悉 React、Vue.js，熟悉 Next.js、Nuxt.js 等 SSR 框架\n开发语言：TypeScript、JavaScript(ES6+)、HTML5、CSS3\nUI/样式：熟悉 TailwindCSS、Sass/Less、CSS Module、Styled-components\n状态管理：Redux、Vuex、Zustand、Jotai、React Query\n工程化工具：Webpack、Vite、Rollup、Babel、ESLint\n测试工具：Jest、React Testing Library、Cypress\n性能优化：熟悉浏览器渲染原理、性能指标监控、代码分割、懒加载等优化技术\n版本控制：Git、SVN\n技术管理：具备团队管理经验，主导过多个大型项目的技术选型和架构设计',
    ),
    selfEvaluationContent: textareaToParagraphHtml(
      '具备大型前端项目架构设计与团队协作经验，擅长把复杂需求拆解成可落地方案。\n对工程化、性能优化和组件抽象有持续积累，能够在业务推进和技术质量之间找到平衡。',
    ),
    activeSection: 'basic',
    draggingProjectId: null,
    globalSettings: getDefaultGlobalSettings(templateId),
    menuSections: DEFAULT_SECTIONS,
  })
}

export function ensureResumeDefaults<T extends ResumeData | Omit<ResumeData, 'id' | 'createdAt' | 'updatedAt'>>(resume: T): T {
  const fieldOrder = resume.basic.fieldOrder?.length ? resume.basic.fieldOrder : cloneBasicFieldOrder()
  const icons = (resume.basic.icons ?? DEFAULT_BASIC_ICONS) as Record<string, string>
  const defaultSettings = getDefaultGlobalSettings(resume.templateId)
  const usesLegacyPlatformTypography =
    !resume.globalSettings?.fontFamily &&
    resume.globalSettings?.baseFontSize === 13
  const customFields = (resume.basic.customFields ?? []).map((field) => ({
    ...field,
    visible: field.visible ?? true,
    custom: field.custom ?? true,
    displayLabel: field.displayLabel ?? false,
  }))
  const legacy = resume as T & {
    basic?: T extends { basic: infer B } ? B & { gender?: string } : never
    skills?: Array<{ name?: string }>
    selfEvaluation?: string
  }
  const legacySkillContent =
    typeof (resume as ResumeData).skillContent === 'string'
      ? (resume as ResumeData).skillContent
      : legacy.skills?.length
        ? textareaToListHtml(legacy.skills.map((item) => item.name ?? '').filter(Boolean).join('\n'))
        : ''
  const legacySelfEvaluation =
    typeof (resume as ResumeData).selfEvaluationContent === 'string'
      ? (resume as ResumeData).selfEvaluationContent
      : typeof legacy.selfEvaluation === 'string'
        ? textareaToParagraphHtml(legacy.selfEvaluation)
        : ''

  return {
    ...resume,
    basic: {
      ...resume.basic,
      employementStatus: resume.basic.employementStatus ?? '',
      birthDate: resume.basic.birthDate ?? '',
      email: resume.basic.email ?? '',
      phone: resume.basic.phone ?? '',
      location: resume.basic.location ?? '',
      fieldOrder,
      icons,
      customFields,
      photo: resume.basic.photo ?? '',
      photoConfig: resume.basic.photoConfig ?? { ...DEFAULT_PHOTO_CONFIG },
      githubKey: resume.basic.githubKey ?? '',
      githubUseName: resume.basic.githubUseName ?? '',
      githubContributionsVisible: resume.basic.githubContributionsVisible ?? false,
    },
    certificates: (resume as ResumeData).certificates ?? [],
    customData: (resume as ResumeData).customData ?? {},
    skillContent: legacySkillContent,
    selfEvaluationContent: legacySelfEvaluation,
    activeSection: (resume as ResumeData).activeSection ?? 'basic',
    draggingProjectId: (resume as ResumeData).draggingProjectId ?? null,
    globalSettings: usesLegacyPlatformTypography
      ? {
          ...defaultSettings,
          themeColor: resume.globalSettings.themeColor ?? defaultSettings.themeColor,
        }
      : {
          ...defaultSettings,
          ...resume.globalSettings,
        },
    menuSections: resume.menuSections?.length ? resume.menuSections : DEFAULT_SECTIONS,
  }
}

export const SECTION_LABELS: Record<ResumeSectionId, string> = {
  basic: '基本信息',
  skills: '专业技能',
  experience: '工作经历',
  projects: '项目经历',
  education: '教育经历',
  selfEvaluation: '自我评价',
}
