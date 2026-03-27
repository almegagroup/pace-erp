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
  background: "rgba(2, 8, 23, 0.56)",
  zIndex: 999998,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
};

const boxStyle = {
  background: "#ffffff",
  borderRadius: "18px",
  padding: "24px",
  boxShadow: "0 24px 80px rgba(15, 23, 42, 0.28)",
};

const eyebrowStyle = {
  margin: 0,
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.12em",
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
  margin: "14px 0 0",
  fontSize: "15px",
  lineHeight: 1.6,
  color: "#334155",
};

const actionsStyle = {
  marginTop: "22px",
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
};
