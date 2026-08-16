"use client";

import { useState, type InputHTMLAttributes } from "react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
	showLabel: string;
	hideLabel: string;
};

export function PasswordInput({ showLabel, hideLabel, ...input }: PasswordInputProps) {
	const [visible, setVisible] = useState(false);
	const label = visible ? hideLabel : showLabel;

	return (
		<div className="password-control">
			<input {...input} type={visible ? "text" : "password"} />
			<button className="password-visibility" type="button" aria-label={label} title={label} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>
				<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<path d="M2.5 12s3.3-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.3 5.5-9.5 5.5S2.5 12 2.5 12Z" />
					<circle cx="12" cy="12" r="2.8" />
					{visible ? null : <path d="m4 4 16 16" />}
				</svg>
			</button>
		</div>
	);
}
