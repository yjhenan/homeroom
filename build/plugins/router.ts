import type { RouteMeta } from 'vue-router';
import ElegantVueRouter from '@elegant-router/vue/vite';
import type { RouteKey } from '@elegant-router/types';

export function setupElegantRouter() {
  return ElegantVueRouter({
    layouts: {
      base: 'src/layouts/base-layout/index.vue',
      blank: 'src/layouts/blank-layout/index.vue'
    },
    onRouteMetaGen(routeName) {
      const key = routeName as RouteKey;

      const constantRoutes: RouteKey[] = ['403', '404', '500'];

      /** 菜单排序（docs/03 模块顺序），无 order 的排最前 */
      const routeOrder: Partial<Record<RouteKey, number>> = {
        home: 1,
        student: 2
      };

      const meta: Partial<RouteMeta> = {
        title: key,
        i18nKey: `route.${key}` as App.I18n.I18nKey
      };

      if (constantRoutes.includes(key)) {
        meta.constant = true;
      }

      if (routeOrder[key] !== undefined) {
        meta.order = routeOrder[key];
      }

      return meta;
    }
  });
}
