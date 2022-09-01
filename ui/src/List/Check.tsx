import { Color } from "../Color";

const Mark = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1rem"
      height="1rem"
      viewBox="0 0 512 512"
    >
      <polyline
        points="416 128 192 384 96 288"
        style="fill:none;stroke:#fff;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px"
      />
    </svg>
  );
  
  export const Check = ({
    visible,
    checked,
    checkedColor = Color.blue,
    borderColor = Color.gray
  }: {
    visible: boolean;
    checked: boolean;
    checkedColor?:Color,
    borderColor?:Color
  }) => (
    <span
      style={{
        position: 'relative',
        height: '1.15rem',
        overflow: 'hidden',
        display: 'inline-block',
        width: '1.2rem',
        maxWidth: visible ? '1.2rem' : 0,
        marginRight: visible ? '10px' : 0,
        transition: 'left, margin, max-width .4s ease-in-out',
      }}
    >
      <span
        style={{
          borderRadius: '200%',
          height: '1.15rem',
          width: '1.15rem',
          backgroundColor: checked ? checkedColor + '' : 'unset',
          border: `2px solid ${checked ? checkedColor : borderColor}`,
          display: 'inline-block',
          position: 'absolute',
          left: visible ? '0px' : '-5px',
          transition: 'left .4s ease-in-out',
        }}
      >
        <Mark />
      </span>
    </span>
  );