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
      {title ? <h2 style={titleStyle}>{title}</h2> : null}
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
  background: "rgba(15, 23, 42, 0.28)",
  zIndex: 999997,
  display: "flex",
  alignItems: "stretch",
  padding: "12px",
  pointerEvents: "auto",
  overscrollBehavior: "contain",
};

const panelStyle = {
  height: "100%",
  background: "#f7f9fc",
  border: "1px solid #94a3b8",
  borderRadius: "0",
  boxShadow: "0 18px 48px rgba(15, 23, 42, 0.2)",
  padding: "20px",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  pointerEvents: "auto",
  overscrollBehavior: "contain",
};

const titleStyle = {
  margin: 0,
  fontSize: "20px",
  fontWeight: 700,
  color: "#0f172a",
};

const contentStyle = {
  marginTop: "18px",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const actionsStyle = {
  marginTop: "22px",
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
  flexShrink: 0,
};
