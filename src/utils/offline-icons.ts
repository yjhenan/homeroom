/**
 * 离线图标注册表：构建期内联（~icons/*），SvgIcon 优先查此表
 *
 * 为什么：@iconify/vue 的 <Icon> 默认走 api.iconify.design 在线拉取，
 * 断网（M4 验收：拔网线可用）或首屏无缓存时会失败。
 * 新增图标：import 后登记到 offlineIcons；@iconify/json 已含主流集合。
 */
import type { Component } from 'vue';
import IconMenu from '~icons/mdi/menu';
import IconMonitorDashboard from '~icons/mdi/monitor-dashboard';
import IconSchoolOutline from '~icons/mdi/school-outline';
import IconAccountMultipleOutline from '~icons/mdi/account-multiple-outline';
import IconCalendarCheckOutline from '~icons/mdi/calendar-check-outline';
import IconChartBoxOutline from '~icons/mdi/chart-box-outline';
import IconHandCoinOutline from '~icons/mdi/hand-coin-outline';
import IconBroom from '~icons/mdi/broom';
import IconFolderOpenOutline from '~icons/mdi/folder-open-outline';
import IconCogOutline from '~icons/mdi/cog-outline';
import IconPin from '~icons/mdi/pin';
import IconPinOff from '~icons/mdi/pin-off';
import IconPinOutline from '~icons/mdi/pin-outline';
import IconPinOffOutline from '~icons/mdi/pin-off-outline';
import IconFormatAlignLeft from '~icons/mdi/format-horizontal-align-left';
import IconFormatAlignRight from '~icons/mdi/format-horizontal-align-right';
import IconMenuFoldLeft from '~icons/line-md/menu-fold-left';
import IconMenuFoldRight from '~icons/line-md/menu-fold-right';
import IconCloseOutlined from '~icons/ant-design/close-outlined';
import IconColumnWidthOutlined from '~icons/ant-design/column-width-outlined';
import IconLineOutlined from '~icons/ant-design/line-outlined';
import IconColorSwatchLine from '~icons/majesticons/color-swatch-line';
import IconLanguage from '~icons/heroicons/language';
import IconSunny from '~icons/material-symbols/sunny';
import IconNightlight from '~icons/material-symbols/nightlight-rounded';
import IconHdrAuto from '~icons/material-symbols/hdr-auto';

export const offlineIcons: Record<string, Component> = {
  'mdi:menu': IconMenu,
  'mdi:monitor-dashboard': IconMonitorDashboard,
  'mdi:school-outline': IconSchoolOutline,
  'mdi:account-multiple-outline': IconAccountMultipleOutline,
  'mdi:calendar-check-outline': IconCalendarCheckOutline,
  'mdi:chart-box-outline': IconChartBoxOutline,
  'mdi:hand-coin-outline': IconHandCoinOutline,
  'mdi:broom': IconBroom,
  'mdi:folder-open-outline': IconFolderOpenOutline,
  'mdi:cog-outline': IconCogOutline,
  'mdi:pin': IconPin,
  'mdi:pin-off': IconPinOff,
  'mdi:pin-outline': IconPinOutline,
  'mdi:pin-off-outline': IconPinOffOutline,
  'mdi:format-horizontal-align-left': IconFormatAlignLeft,
  'mdi:format-horizontal-align-right': IconFormatAlignRight,
  'line-md:menu-fold-left': IconMenuFoldLeft,
  'line-md:menu-fold-right': IconMenuFoldRight,
  'ant-design:close-outlined': IconCloseOutlined,
  'ant-design:column-width-outlined': IconColumnWidthOutlined,
  'ant-design:line-outlined': IconLineOutlined,
  'majesticons:color-swatch-line': IconColorSwatchLine,
  'heroicons:language': IconLanguage,
  'material-symbols:sunny': IconSunny,
  'material-symbols:nightlight-rounded': IconNightlight,
  'material-symbols:hdr-auto': IconHdrAuto
};
