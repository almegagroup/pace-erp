import BlockingLayer from "./BlockingLayer.jsx";

export default function DrawerBase({
  visible,
  title,
  children,
  actions,
  contentProps,
  actionsProps,
  onEscape,
  initialFocusRef,
  side = "right",
  width = "min(420px, calc(100vw - 24px))",
}) {
  const justifyContent =
    side === "left" ? "flex-start" : side === "center" ? "center" : "flex-end";

  return (
    <BlockingLayer
      visible={visible}
      onEscape={onEscape}
      initialFocusRef={initialFocusRef}
      overlayStyle={{
        ...overlayStyle,
        justifyContent,
      }}
      dialogStyle={{
        ...panelStyle,
        width,
      }}
    >
      {title ? (
        <div style={headerStyle}>
          <h2 style={titleStyle}>{title}</h2>
        </div>
      ) : null}
      <div
        {...contentProps}
        style={{
          ...contentStyle,
          ...(contentProps?.style || {}),
        }}
      >
        {children}
      </div>
      {actions ? (
        <div
          data-erp-nav-group="true"
          data-erp-nav-axis="horizontal"
          {...actionsProps}
          style={{
            ...actionsStyle,
            ...(actionsProps?.style || {}),
          }}
        >
          {actions}
        </div>
      ) : null}
    </BlockingLayer>
  );
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background:
    "linear-gradient(180deg, rgba(15, 23, 42, 0.34) 0%, rgba(15, 23, 42, 0.22) 100%)",
  zIndex: 999997,
  display: "flex",
  alignItems: "stretch",
  padding: "12px",
  pointerEvents: "auto",
  overscrollBehavior: "contain",
};

const panelStyle = {
  height: "100%",
  background: "#f8fafc",
  border: "1px solid #8d9baa",
  borderRadius: "0",
  boxShadow: "0 18px 48px rgba(15, 23, 42, 0.24)",
  padding: "0",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  pointerEvents: "auto",
  overscrollBehavior: "contain",
};

const headerStyle = {
  borderBottom: "1px solid #cbd5e1",
  background: "linear-gradient(180deg, #f7fafc 0%, #eef3f7 100%)",
  padding: "18px 20px 16px",
};

const titleStyle = {
  margin: 0,
  fontSize: "18px",
  fontWeight: 700,
  color: "#0f172a",
};

const contentStyle = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  padding: "18px 20px",
};

const actionsStyle = {
  marginTop: 0,
  borderTop: "1px solid #cbd5e1",
  background: "#eef3f7",
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
  flexShrink: 0,
  padding: "16px 20px",
};
