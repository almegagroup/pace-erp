import BlockingLayer from "./BlockingLayer.jsx";

export default function ModalBase({
  visible,
  title,
  eyebrow,
  message,
  children,
  actions,
  contentProps,
  actionsProps,
  onEscape,
  initialFocusRef,
  width = "min(440px, calc(100vw - 32px))",
}) {
  return (
    <BlockingLayer
      visible={visible}
      onEscape={onEscape}
      initialFocusRef={initialFocusRef}
      overlayStyle={overlayStyle}
      dialogStyle={{
        ...boxStyle,
        width,
      }}
    >
      <div style={headerStyle}>
        {eyebrow ? <p style={eyebrowStyle}>{eyebrow}</p> : null}
        {title ? <p style={titleStyle}>{title}</p> : null}
        {message ? <p style={messageStyle}>{message}</p> : null}
      </div>
      {children ? (
        <div
          {...contentProps}
          style={{
            ...contentStyle,
            ...(contentProps?.style || {}),
          }}
        >
          {children}
        </div>
      ) : null}
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
    "linear-gradient(180deg, rgba(15, 23, 42, 0.42) 0%, rgba(15, 23, 42, 0.3) 100%)",
  zIndex: 999998,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
};

const boxStyle = {
  background: "#f8fafc",
  border: "1px solid #8d9baa",
  borderRadius: "0",
  padding: "0",
  boxShadow: "0 28px 72px rgba(15, 23, 42, 0.24)",
};

const headerStyle = {
  borderBottom: "1px solid #cbd5e1",
  background: "linear-gradient(180deg, #f7fafc 0%, #eef3f7 100%)",
  padding: "18px 22px 16px",
};

const eyebrowStyle = {
  margin: 0,
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "#0369a1",
};

const titleStyle = {
  margin: "8px 0 0",
  fontSize: "18px",
  fontWeight: 700,
  color: "#0f172a",
};

const messageStyle = {
  margin: "10px 0 0",
  fontSize: "14px",
  lineHeight: 1.55,
  color: "#475569",
};

const contentStyle = {
  maxHeight: "min(70vh, 760px)",
  overflow: "auto",
  padding: "18px 22px",
};

const actionsStyle = {
  marginTop: 0,
  borderTop: "1px solid #cbd5e1",
  background: "#eef3f7",
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
  padding: "16px 22px",
};
