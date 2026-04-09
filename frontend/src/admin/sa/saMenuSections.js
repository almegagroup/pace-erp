import {
  buildMenuTree,
  flattenRouteableMenu,
  getSidebarRoots,
} from "../../navigation/menuProjection.js";

function collectRoutePages(nodes, excludeSet, pages = [], seen = new Set()) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const item = node?.item ?? null;

    if (
      item?.route_path &&
      item?.menu_code &&
      !excludeSet.has(item.menu_code) &&
      !seen.has(item.menu_code)
    ) {
      seen.add(item.menu_code);
      pages.push(item);
    }

    if (node?.children?.length) {
      collectRoutePages(node.children, excludeSet, pages, seen);
    }
  }

  return pages;
}

export function buildSaMenuSections(menu, { excludeMenuCodes = [] } = {}) {
  const excludeSet = new Set(excludeMenuCodes);
  const tree = buildMenuTree(menu);
  const roots = getSidebarRoots(tree);

  const sections = roots
    .map((node) => {
      const pages = [];
      const seen = new Set();
      const item = node?.item ?? null;

      if (
        item?.route_path &&
        item?.menu_code &&
        !excludeSet.has(item.menu_code) &&
        !seen.has(item.menu_code)
      ) {
        seen.add(item.menu_code);
        pages.push(item);
      }

      collectRoutePages(node?.children ?? [], excludeSet, pages, seen);

      return {
        key: item?.menu_code ?? `section-${pages.length}`,
        title: item?.title ?? "Available Workspaces",
        description: item?.description ?? "",
        pages,
      };
    })
    .filter((section) => section.pages.length > 0);

  if (sections.length > 0) {
    return sections;
  }

  const fallbackPages = flattenRouteableMenu(tree).filter(
    (item) => item?.menu_code && !excludeSet.has(item.menu_code)
  );

  return fallbackPages.length > 0
    ? [
        {
          key: "available-workspaces",
          title: "Available Workspaces",
          description: "Open the next Super Admin workspace from the published menu.",
          pages: fallbackPages,
        },
      ]
    : [];
}

export function flattenSaMenuSections(sections) {
  return sections.flatMap((section) =>
    section.pages.map((page) => ({
      ...page,
      sectionKey: section.key,
      sectionTitle: section.title,
      sectionDescription: section.description,
    }))
  );
}
