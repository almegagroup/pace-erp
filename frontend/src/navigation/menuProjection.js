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

export function getAncestorMenuCodes(tree, routePath) {
  const ancestors = [];

  function visit(nodes, trail = []) {
    for (const node of nodes) {
      const nextTrail = node.item?.menu_code
        ? [...trail, node.item.menu_code]
        : trail;

      if (node.item?.route_path === routePath) {
        ancestors.push(...trail);
        return true;
      }

      if (node.children?.length && visit(node.children, nextTrail)) {
        return true;
      }
    }

    return false;
  }

  visit(tree);
  return ancestors;
}

export function flattenDrawerEntries(tree, expandedMenuCodes = new Set()) {
  const entries = [];

  function visit(nodes, depth = 0) {
    for (const node of nodes) {
      const hasChildren = (node.children ?? []).length > 0;
      const isExpanded = expandedMenuCodes.has(node.item.menu_code);

      if (hasChildren) {
        entries.push({
          key: node.item.menu_code,
          kind: "drawer",
          item: node.item,
          depth,
          children: node.children,
          isExpanded,
        });

        if (isExpanded) {
          if (node.item.route_path) {
            entries.push({
              key: `${node.item.menu_code}__page`,
              kind: "page",
              item: {
                ...node.item,
                title: `Open ${node.item.title}`,
              },
              depth: depth + 1,
            });
          }

          visit(node.children, depth + 1);
        }

        continue;
      }

      if (node.item.route_path) {
        entries.push({
          key: node.item.menu_code,
          kind: "page",
          item: node.item,
          depth,
        });
      }
    }
  }

  visit(tree);
  return entries;
}

export function getTopLevelRoutePages(tree) {
  return (Array.isArray(tree) ? tree : [])
    .map((node) => node?.item)
    .filter((item) => item?.route_path);
}
