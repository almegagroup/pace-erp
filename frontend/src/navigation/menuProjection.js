function getMenuOrder(item) {
  return item?.tree_display_order ?? item?.display_order ?? 0;
}

export function compareMenuItems(left, right) {
  return (
    getMenuOrder(left) - getMenuOrder(right) ||
    String(left?.title ?? "").localeCompare(String(right?.title ?? ""), "en", {
      numeric: true,
      sensitivity: "base",
    })
  );
}

export function buildMenuTree(menu) {
  const rows = Array.isArray(menu) ? menu.filter(Boolean) : [];
  const knownCodes = new Set(
    rows
      .map((item) => item.menu_code)
      .filter(Boolean),
  );
  const childrenByParent = new Map();

  for (const item of rows) {
    const parentCode =
      item.parent_menu_code && knownCodes.has(item.parent_menu_code)
        ? item.parent_menu_code
        : "__ROOT__";

    if (!childrenByParent.has(parentCode)) {
      childrenByParent.set(parentCode, []);
    }

    childrenByParent.get(parentCode).push(item);
  }

  function walk(parentCode, ancestry = new Set()) {
    const branch = [...(childrenByParent.get(parentCode) ?? [])].sort(compareMenuItems);

    return branch.map((item) => {
      const nextAncestry = new Set(ancestry);

      if (nextAncestry.has(item.menu_code)) {
        return { item, children: [] };
      }

      nextAncestry.add(item.menu_code);

      return {
        item,
        children: walk(item.menu_code, nextAncestry),
      };
    });
  }

  return walk("__ROOT__");
}

export function flattenRouteableMenu(tree) {
  const pages = [];

  function visit(nodes) {
    for (const node of nodes) {
      if (node.item?.route_path) {
        pages.push(node.item);
      }

      if (node.children?.length) {
        visit(node.children);
      }
    }
  }

  visit(tree);
  return pages;
}

export function branchContainsRoute(node, routePath) {
  if (!node) {
    return false;
  }

  if (node.item?.route_path === routePath) {
    return true;
  }

  return (node.children ?? []).some((child) => branchContainsRoute(child, routePath));
}
