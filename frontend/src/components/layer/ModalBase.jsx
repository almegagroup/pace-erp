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
  background: "rgba(2, 8, 23, 0.72)",
  zIndex: 999998,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
};

const boxStyle = {
  background:
    "linear-gradient(180deg, rgba(10, 23, 29, 0.98) 0%, rgba(9, 19, 25, 0.98) 100%)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "24px",
  padding: "24px",
  boxShadow: "0 28px 96px rgba(0, 0, 0, 0.42)",
};

const eyebrowStyle = {
  margin: 0,
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "#6ee7b7",
};

const titleStyle = {
  margin: "8px 0 0",
  fontSize: "20px",
  fontWeight: 700,
  color: "#f8fafc",
};

const messageStyle = {
  margin: "14px 0 0",
  fontSize: "15px",
  lineHeight: 1.6,
  color: "#cbd5e1",
};

const actionsStyle = {
  marginTop: "22px",
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
};
