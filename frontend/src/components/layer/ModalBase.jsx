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
      {eyebrow ? <p style={eyebrowStyle}>{eyebrow}</p> : null}
      {title ? <p style={titleStyle}>{title}</p> : null}
      {message ? <p style={messageStyle}>{message}</p> : null}
      {children ? <div {...contentProps}>{children}</div> : null}
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
  background: "rgba(15, 23, 42, 0.34)",
  zIndex: 999998,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
};

const boxStyle = {
  background: "#f8fbfd",
  border: "1px solid #94a3b8",
  borderRadius: "0",
  padding: "24px",
  boxShadow: "0 28px 72px rgba(15, 23, 42, 0.18)",
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
  fontSize: "20px",
  fontWeight: 700,
  color: "#0f172a",
};

const messageStyle = {
  margin: "14px 0 0",
  fontSize: "15px",
  lineHeight: 1.6,
  color: "#475569",
};

const actionsStyle = {
  marginTop: "22px",
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
};
