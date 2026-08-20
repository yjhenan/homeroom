import { locale } from 'dayjs';
import 'dayjs/locale/zh-cn';

/**
 * Set dayjs locale
 *
 * @param lang
 */
export function setDayjsLocale(lang: App.I18n.LangType = 'zh-CN') {
  const localMap = {
    'zh-CN': 'zh-cn'
  } satisfies Record<App.I18n.LangType, string>;

  locale(localMap[lang]);
}
