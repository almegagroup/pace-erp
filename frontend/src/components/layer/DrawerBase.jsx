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
  background: "rgba(2, 8, 23, 0.48)",
  zIndex: 999997,
  display: "flex",
  alignItems: "stretch",
  padding: "12px",
};

const panelStyle = {
  height: "100%",
  background: "#ffffff",
  borderRadius: "24px",
  boxShadow: "0 24px 80px rgba(15, 23, 42, 0.24)",
  padding: "24px",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
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
